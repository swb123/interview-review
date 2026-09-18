# 三、并发编程与锁机制（P7源码级）
> **目标岗位：阿里 P7 后端开发**  
P7 核心能力要求：能从源码级解释锁升级机制、AQS 设计范式、能根据业务场景选择并发方案并解释理由、能诊断并发 Bug（死锁/活锁/饥饿/伪共享）并给出根治方案。
>

---

## 📋 知识体系总览
```plain
并发编程与锁机制
├── Java 内置锁
│   ├── synchronized 锁升级（无锁→偏向→轻量级→重量级 + Mark Word）
│   ├── JIT 锁优化（锁消除、锁粗化、逃逸分析）
│   └── vs ReentrantLock 全景对比
├── J.U.C 框架源码
│   ├── AQS（CLH 队列、state/CAS/park-unpark 三板斧、模板方法）
│   ├── ReentrantLock（公平/非公平、可重入、Condition）
│   ├── ReentrantReadWriteLock（读写状态、锁降级、写饥饿）
│   ├── StampedLock（乐观读、不可重入、JDK8+）
│   └── 同步工具（CountDownLatch/CyclicBarrier/Semaphore/Phaser）
├── 线程池
│   ├── 参数与流程（core/max/queue/reject 四步）
│   ├── 动态调参与监控（运行时参数调整 + 指标暴露）
│   └── 线程池隔离与容量规划公式
├── 并发容器
│   ├── ConcurrentHashMap（JDK7 Segment→JDK8 CAS+synchronized、sizeCtl、扩容）
│   ├── CopyOnWriteArrayList（写时复制、弱一致性）
│   └── ConcurrentLinkedQueue（无锁 CAS、Michael-Scott 队列）
├── 并发编程范式
│   ├── ThreadLocal/InheritableThreadLocal/TransmittableThreadLocal
│   ├── CompletableFuture（异步编排、异常处理、线程池隔离）
│   ├── 乐观锁 vs 悲观锁（CAS/版本号/DB 锁 选型矩阵）
│   └── 伪共享与缓存行填充（@Contended、Disruptor）
└── 排障与面试
    ├── 死锁检测（jstack/ThreadMXBean/自定义检测器）
    ├── CPU 100% 排查（top+jstack 定位死循环/锁竞争）
    └── STAR 映射表
```

**P6 vs P7 回答层次：**

| 维度 | P6 回答 | P7 回答 |
| --- | --- | --- |
| synchronized | 说出锁升级四个阶段 | 能画出 Mark Word 每阶段 Bit 布局、解释偏向锁撤销的 STW 代价、结合 JIT 锁消除/粗化 |
| AQS | 说出 state+CAS+CLH 队列 | 能分析 waitStatus 状态流转、解释为什么用前驱节点 SIGNAL 而不是自旋、分析取消节点处理 |
| 线程池 | 说出七个参数和流程 | 能给出容量计算公式、设计动态线程池（配置中心下发）、分析不同队列的策略含义 |
| 并发容器 | 说出 CHM 分段锁 | 能分析 sizeCtl 的多重语义、解释扩容时的多线程协作（transferIndex）、分析为什么不用 Segment |
| ThreadLocal | 说出弱引用和 remove | 能分析在线程池中的内存泄漏路径、使用 TTL 解决异步上下文传递、分析 Netty FastThreadLocal |


---

## 参考资源
+ 《Java 并发编程的艺术》方腾飞
+ 《Java 并发编程实战》Brian Goetz
+ OpenJDK 源码 — AQS / ReentrantLock / ConcurrentHashMap
+ 《深入理解 Java 虚拟机》第3版 — 第13章 线程安全与锁优化
+ 死磕 Java 并发 — AQS 源码分析系列

---

### Q1：synchronized 锁升级的完整过程是怎样的？Mark Word 在每个阶段如何变化？与 ReentrantLock 有何区别？
**A：**

**1. Mark Word 结构（64位 JVM，5 种状态）**

```plain
32位 JVM (简化):
┌──────────────────────┬──────┬──────┬──────┬───────┐
│      hashCode        │ GC年龄│偏向锁│锁标志│  状态  │
├──────────────────────┼──────┼──────┼──────┼───────┤
│  hashCode(25bit)      │ age  │  0   │  01  │ 无锁   │
│  threadID(23)+epoch(2)│ age  │  1   │  01  │ 偏向锁 │
│  指向LockRecord的指针  │      │      │  00  │ 轻量级 │
│  指向ObjectMonitor指针 │      │      │  10  │ 重量级 │
│   空                  │      │      │  11  │ GC标记 │
└──────────────────────┴──────┴──────┴──────┴───────┘
```

**2. 锁升级全流程（P7 必须能画出来）**

```plain
无锁 (01, 0)
  │ 第一个线程访问
  ▼
偏向锁 (01, 1)
  │ 线程通过 CAS 将 ThreadID 写入 Mark Word
  │ 之后同一个线程进入同步块：只检查 ThreadID 匹配 → 零开销！
  │
  │ 另一个线程竞争 → 偏向锁撤销（Stop-The-World SafePoint 撤销！）
  ▼
轻量级锁 (00)
  │ 线程在栈帧中创建 Lock Record，CAS 将 Mark Word 指向 Lock Record
  │ 失败 → 自适应自旋（smart spin）
  │ 自旋超时 或 等待线程数增加 或 第三个线程加入竞争
  ▼
重量级锁 (10)
  │ Mark Word → ObjectMonitor 指针
  │ 未获取锁的线程 → 挂起(park) → 进入 EntryList → 内核态
  └─ ObjectMonitor 结构: _owner(持有线程) / _EntryList(竞争队列) / _WaitSet(wait队列)
```

**关键追问**：

+ **为什么偏向锁撤销需要 STW？** 因为要遍历线程栈帧检查锁记录，需要一致的内存视图。
+ **JDK15 后为什么默认关闭偏向锁？** 高并发场景下偏向锁撤销的 STW 代价 > 收益，现代应用大多是高并发服务。
+ **自适应自旋**：JVM 根据历史自旋成功率动态调整自旋次数（前一次成功 → 更容易继续自旋）。

**3. JIT 锁优化**

| 优化 | 原理 | 触发条件 |
| --- | --- | --- |
| **锁消除** | 逃逸分析发现对象不会逃逸线程 → 去除同步 | 局部变量，不返回/传递给外部 |
| **锁粗化** | 连续加锁解锁合并为一次 | 循环内反复加锁 → 移到循环外 |


**4. synchronized vs ReentrantLock — P7 选型**

| 维度 | synchronized | ReentrantLock |
| --- | --- | --- |
| 实现 | JVM 关键字，C++ ObjectMonitor | JDK API，Java AQS |
| 公平性 | 仅非公平 | 可公平/非公平 |
| 可中断 | ❌ 不可中断 | ✅ `lockInterruptibly()` |
| 超时 | ❌ | ✅ `tryLock(timeout)` |
| 条件变量 | 1 个 wait/notify | 多个 Condition |
| 自动释放 | ✅（代码块结束/异常） | ❌ 需 finally unlock |
| 性能 | JDK6+ 优化后近似 | 高竞争下灵活定制优势 |


> **P7 决策**：默认用 synchronized（简洁+JVM 自动优化）；需要可中断/超时/多条件/公平锁时用 ReentrantLock。
>

---

### Q2：AQS 框架如何实现同步？以 ReentrantLock 非公平锁为例，分析 lock 和 unlock 的源码流程。
**A：**

**1. AQS 三板斧**

```plain
┌──────────────────────────────────────────────┐
│              AQS (AbstractQueuedSynchronizer) │
├──────────────────────────────────────────────┤
│ ① volatile int state     ← 同步状态          │
│    (ReentrantLock: 0=未锁, >0=重入次数)       │
│                                              │
│ ② CLH 变种双向链表队列    ← 节点排队           │
│    Node { thread, waitStatus, prev, next }   │
│                                              │
│ ③ CAS + park/unpark      ← 原子操作+阻塞      │
│    Unsafe.compareAndSwapInt                  │
│    LockSupport.park / unpark                 │
└──────────────────────────────────────────────┘
```

**2. Node waitStatus 状态机（P7 关键）**

```plain
SIGNAL(-1): 后继节点需要被唤醒 ← 前驱释放时唤醒后继的关键标记
CANCELLED(1): 节点被取消（超时/中断）
CONDITION(-2): 节点在 Condition 等待队列中
PROPAGATE(-3): 共享模式下唤醒需要传播
0: 初始状态
```

**3. 非公平锁 lock() 源码级流程**

```java
// ReentrantLock.NonfairSync.lock()
final void lock() {
    // 第1步: 直接CAS抢一次（非公平的灵魂！）
    if (compareAndSetState(0, 1))
        setExclusiveOwnerThread(Thread.currentThread());
    else
        acquire(1);  // 抢失败，走正规流程
}

// AQS.acquire()
public final void acquire(int arg) {
    // 第2步: tryAcquire 再抢一次（非公平：可能锁刚好释放）
    // 第3步: 失败则 addWaiter 入队 + acquireQueued 自旋/阻塞
    if (!tryAcquire(arg) &&
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        selfInterrupt();
}
```

**acquireQueued 自旋逻辑**：

```java
final boolean acquireQueued(final Node node, int arg) {
    for (;;) {
        final Node p = node.predecessor();
        if (p == head && tryAcquire(arg)) {  // 前驱是head才有资格tryAcquire
            setHead(node);  // 自己成为新head，出队
            return false;
        }
        // shouldParkAfterFailedAcquire: 前驱waitStatus == SIGNAL 时才 park
        // 不是SIGNAL → 设为SIGNAL；是CANCELLED → 跳过取消节点
        if (shouldParkAfterFailedAcquire(p, node) &&
            parkAndCheckInterrupt())   // LockSupport.park(this)
            interrupted = true;
    }
}
```

**为什么是检查前驱的 SIGNAL 状态而不是自己自旋？** 前驱 SIGNAL = "我释放时会唤醒你"，当前线程可以安心 park，避免 CPU 空转。

**4. unlock() 流程**

```java
// ReentrantLock.unlock()
public void unlock() { sync.release(1); }

// AQS.release()
public final boolean release(int arg) {
    if (tryRelease(arg)) {       // state-1, state==0 → 清空owner, return true
        Node h = head;
        if (h != null && h.waitStatus != 0)  // SIGNAL状态 → 有等待者
            unparkSuccessor(h);  // 唤醒head.next
        return true;
    }
    return false;
}
```

**5. 公平锁 vs 非公平锁 — 唯一区别**

```java
// 公平锁的 tryAcquire 多一行：
if (c == 0) {
    if (!hasQueuedPredecessors() &&  // ← 检查队列中是否有人排更早！
        compareAndSetState(0, acquires)) {
        setExclusiveOwnerThread(current);
        return true;
    }
}
// hasQueuedPredecessors(): head.next != null && head.next.thread != currentThread
```

**6. Condition 实现原理**

```plain
AQS 内部维护两个队列:
  同步队列 (CLH): 等待获取锁的线程
  条件队列 (单向): 调用了 await() 的线程

await(): 将当前线程加入条件队列尾部 → 释放锁 → park 等待 signal
signal(): 将条件队列的 head 移到同步队列尾部 → 等待锁被释放后获取
```

---

### Q3：ReentrantReadWriteLock 的读写锁机制是怎样的？什么是锁降级？与 StampedLock 对比？
**A：**

**1. 读写状态设计**

```plain
AQS state (int 32位):
  ┌────────────────────┬────────────────────┐
  │    高16位: 读锁计数  │   低16位: 写锁重入  │
  │   (sharedCount)    │  (exclusiveCount)  │
  └────────────────────┴────────────────────┘

读锁次数: state >>> 16
写锁次数: state & 0x0000FFFF
```

**2. 写锁获取**

```plain
① state != 0 → 有锁
   ├─ 写锁计数==0（仅有读锁）→ 失败（不能写，防止脏读）
   └─ 写锁计数>0 且 owner != 自己 → 失败
② state == 0 → CAS state = 1 → 成功，设 owner
③ 写锁可重入: state += 1（低16位递增）
```

**3. 读锁获取**

```plain
① 写锁被其他线程持有 → 入队阻塞
② 写锁是自己持有（锁降级）→ 允许，继续获取读锁
③ 无写锁或被自己持有 → CAS state += (1<<16)
   └─ 每个线程的重入次数记录在 HoldCounter（存于 ThreadLocal）
   └─ 读锁的 firstReader 和 firstReaderHoldCount 优化
```

**4. 锁降级 vs 锁升级**

```plain
锁降级（允许）:
  writeLock.lock()
  readLock.lock()     ← 写锁未释放时获取读锁
  writeLock.unlock()  ← 释放写锁，仅持有读锁
  readLock.unlock()

锁升级（禁止，会死锁）:
  readLock.lock()
  writeLock.lock()    ← 持有读锁时获取写锁 → 死锁
```

**5. StampedLock (JDK8) — P7 加分项**

| 维度 | ReentrantReadWriteLock | StampedLock |
| --- | --- | --- |
| 重入性 | ✅ 可重入 | ❌ 不可重入 |
| 读写模式 | 悲观读 + 写 | 乐观读 + 悲观读 + 写 |
| 乐观读 | ❌ | ✅ `tryOptimisticRead()` 返回 stamp，零锁开销 |
| 性能 | 读多写少场景优秀 | 🏆 乐观读场景碾压 RRW |
| 复杂度 | 中 | 高（stamp 校验、不可重入） |
| Condition | ✅ | ❌ |


**StampedLock 乐观读模式**：

```java
long stamp = lock.tryOptimisticRead();
// 无锁读取...
if (!lock.validate(stamp)) {  // 校验是否有写操作发生
    stamp = lock.readLock();  // 升级为悲观读
    try { /* 重读 */ } finally { lock.unlockRead(stamp); }
}
```

---

### Q4：CountDownLatch、CyclicBarrier、Semaphore 的底层实现与区别？Phaser 是什么？
**A：**

**1. 三剑客源码对比**

| 特性 | CountDownLatch | CyclicBarrier | Semaphore |
| --- | --- | --- | --- |
| **AQS 模式** | 共享 | 独占（ReentrantLock + Condition） | 共享 |
| **state 含义** | 倒数计数（state=0 唤醒所有） | parties 总数 | 许可数量 |
| **可重用** | ❌ 一次性 | ✅ 自动重置 | ✅ release 归还许可 |
| **等待方式** | `await()` 等 state=0 | `await()` 等所有线程到齐 | `acquire()` 等有许可 |
| **经典场景** | 主等子线程完成后汇总 | 多线程分步并行，步调一致 | 限流、连接池 |


**2. CyclicBarrier 自动重置机制**

```java
// 核心逻辑（简化）
int index = --count;
if (index == 0) {  // 最后一个到达
    if (command != null) command.run();  // 执行回调
    nextGeneration();  // 唤醒所有等待线程 + 重置 count=parties + generation++
} else {
    trip.await();  // 在 Condition 上等待其他线程
}
```

**3. Phaser (JDK7) — 更灵活的 CyclicBarrier**

```plain
Phaser 优势:
 ① 动态注册/注销参与者（register/deregister），CyclicBarrier 的 parties 固定
 ② 多阶段协作（arriveAndAwaitAdvance 等所有到达 → 进入下一阶段）
 ③ 可中断/超时
 ④ 可以层级化（父子 Phaser）

场景: 分阶段计算，参与者数量不固定的场景
```

---

### Q5：线程池核心参数及工作流程？如何动态调参和监控？线程池容量如何规划？
**A：**

**1. 任务提交流程四步决策**

```plain
submit(task)
  │
  ├─ ① 当前线程数 < corePoolSize？
  │     └─ YES → 新建核心线程执行（即使有空闲核心线程也新建）
  │
  ├─ ② 队列未满？
  │     └─ YES → 入队等待
  │
  ├─ ③ 当前线程数 < maximumPoolSize？
  │     └─ YES → 新建非核心线程执行
  │
  └─ ④ 执行拒绝策略
```

**关键陷阱**：如果用 `LinkedBlockingQueue`（无界），队列永远不会满 → 永远不会创建非核心线程 → `maximumPoolSize` 形同虚设！

**关键陷阱 2（高频追问）**：当 `corePoolSize=0、maximumPoolSize=N`（合法配置）时：任务提交后 ① 线程数 0 小于 core 0 不成立 → ② 队列未满 → **任务全部直接入队，不创建任何线程**；直到队列满 → ③ 才创建非核心线程（最多 N 个）执行。这意味着突发流量会先把队列灌满才开始并发；队列清空后，所有线程都是非核心线程，keepAliveTime 超时后全部回收，线程数回到 0。适合任务少、偶尔突发的批处理场景。注意：字面「核心=最大=0」是**非法配置**——maximumPoolSize 必须 ≥ 1 且 ≥ corePoolSize（构造时抛 IllegalArgumentException）。

**2. 队列选择策略**

| 队列 | 特点 | 适用 |
| --- | --- | --- |
| `SynchronousQueue` | 无容量，每个 put 必须等 take | 任务少且短，需要快速响应 |
| `LinkedBlockingQueue` | 无界（默认），所有任务排队 | 任务平稳，不会突发（有 OOM 风险） |
| `ArrayBlockingQueue` | 有界，需指定容量 | 🏆 推荐：控制最大排队数 |


**3. 拒绝策略选择**

| 策略 | 行为 | 适用 |
| --- | --- | --- |
| `AbortPolicy`（默认） | 抛 RejectedExecutionException | 必须感知任务拒绝 |
| `CallerRunsPolicy` | 提交者线程自己执行 | 🏆 降级方案，提交者线程帮忙消化 |
| `DiscardPolicy` | 静默丢弃 | 不重要的后台任务 |
| `DiscardOldestPolicy` | 丢弃队首，重试当前 | 优先新任务 |


**4. 线程池容量规划公式（P7 必备）**

```plain
CPU 密集型: coreSize = CPU 核数 + 1
IO 密集型:  coreSize = CPU 核数 × (1 + IO等待时间/CPU计算时间)
           ≈ CPU 核数 × 2（经验值）

队列容量:  根据可接受的等待时间 × QPS 估算
           例: 可等 1s, QPS 500 → 队列 = 500

maximumPoolSize = coreSize + 弹性（应对突发流量，通常 2~3 倍 coreSize）
```

**5. 动态线程池实现要点**

```java
// ThreadPoolExecutor 提供 setter 方法
executor.setCorePoolSize(newCoreSize);
executor.setMaximumPoolSize(newMaxSize);
executor.setKeepAliveTime(newTime, unit);
executor.setRejectedExecutionHandler(newHandler);

// 监控指标暴露
Gauge.builder("threadpool.active", executor, e -> e.getActiveCount())
Gauge.builder("threadpool.queue.size", executor, e -> e.getQueue().size())
Gauge.builder("threadpool.completed", executor, e -> e.getCompletedTaskCount())

// P7 方案: 配置中心(Nacos)下发 → 监听变更 → 动态刷新线程池参数
```

---

### Q6：ThreadLocal 的实现原理，内存泄漏机制？InheritableThreadLocal 和 TransmittableThreadLocal 的区别？
**A：**

**1. 实现原理**

```plain
Thread 对象
  └─ ThreadLocalMap threadLocals
       └─ Entry[] table
            └─ Entry extends WeakReference<ThreadLocal<?>>
                 ├─ key: WeakReference → ThreadLocal 实例
                 └─ value: 强引用 → 存储的对象

ThreadLocal.set(value):
  ① 获取 currentThread().threadLocals
  ② 以当前 ThreadLocal 实例的 threadLocalHashCode 定位槽位
  ③ 开放地址法解决冲突（线性探测，非链表!）
  ④ Entry.key = this(弱引用), Entry.value = value
```

**2. 内存泄漏因果链**

```plain
① ThreadLocal ref = null (外部不再引用)
② GC 回收 ThreadLocal 实例（因为 Entry.key 是弱引用）
③ Entry.key = null ← "脏 Entry"
④ 但 Entry.value 仍然强引用 Value 对象！
⑤ 如果线程不结束（线程池复用）→ Value 永远不释放 → 内存泄漏！
```

**为什么 key 用弱引用？** 如果用强引用，ThreadLocal 外部引用断开后，ThreadLocalMap 中的强引用 key 仍然阻止 GC → ThreadLocal 实例也泄漏。

**3. 泄漏防护机制**

ThreadLocalMap 的 get/set/remove 中会附带清理脏 Entry：

+ `expungeStaleEntry()`: 探测到 key==null → 清理 value → 重新哈希
+ `cleanSomeSlots()`: 快速扫描 log2(n) 次

**P7 对策**：**必须显式 remove()**（放在 finally 块）。使用阿里 TTL 或 Netty FastThreadLocal。

**4. 三种 ThreadLocal 对比**

| 类型 | 原理 | 线程池兼容 |
| --- | --- | --- |
| **ThreadLocal** | 每个 Thread 内部 Map | ❌ 线程复用，上次的 value 残留 |
| **InheritableThreadLocal** | 子线程创建时拷贝父线程 Map | ❌ 仅 new Thread 时拷贝，线程池线程已存在 |
| **TransmittableThreadLocal(TTL)** | 装饰 Runnable/Callable，提交前捕获 → 执行前回放 | ✅ 🏆 解决线程池上下文传递 |


**5. Netty FastThreadLocal 优化**

```plain
FastThreadLocal 优化:
  ① 使用数组替代 ThreadLocalMap（index直接定位，无hash冲突）
  ② 不使用弱引用（手动 remove 清理，无 GC 抖动）
  ③ InternalThreadLocalMap 绑定到 FastThreadLocalThread
  ④ set/get 性能提升约 3 倍
```

---

### Q7：CopyOnWriteArrayList 和 ConcurrentLinkedQueue 的并发原理是什么？ConcurrentHashMap 如何实现线程安全？
**A：**

**1. CopyOnWriteArrayList — 写时复制**

```plain
add(E e):
  ① 加 ReentrantLock
  ② Object[] newArray = Arrays.copyOf(oldArray, oldArray.length + 1)
  ③ newArray[newArray.length-1] = e
  ④ setArray(newArray)  ← 原子替换内部引用
  ⑤ 解锁

读操作: 直接 array[index] ← 无锁！零开销！

陷阱:
  - 写复制整个数组 → O(n) 内存和时间 → 只适合读多写极少
  - 迭代器持有旧数组快照 → 弱一致性 → 迭代期间写入对迭代器不可见
```

**2. ConcurrentLinkedQueue — Michael-Scott 无锁队列**

```plain
入队 offer():
  ① CAS 设置 tail.next = newNode（循环重试直到成功）
  ② 惰性更新 tail = newNode（不保证 tail 始终指向最后一个节点）

出队 poll():
  ① CAS 设置 head = head.next
  ② 惰性更新 head

为什么惰性更新 tail/head？
  - 减少 CAS 竞争（多个线程可以同时入队，只要 CAS next 成功即可）
  - size() 需要 O(n) 遍历（没有维护计数）
```

**3. ConcurrentHashMap — P7 高频**

```plain
JDK7: Segment[] + HashEntry（分段锁，默认16个Segment，并发度16）

JDK8 重构:
  写入:
   ① 槽位为空 → CAS 插入              ← 无锁！
   ② 槽位非空 → synchronized(头节点)   ← JDK8用synchronized替代Segment的ReentrantLock
   ③ 扩容中 → 帮助扩容(helpTransfer)   ← 多线程协同！
  TreeNode: 链表长度>8+table>=64 → 红黑树
  sizeCtl: 控制初始化和扩容的多重语义
  ForwardingNode: 扩容期间的占位节点
```

**sizeCtl 多重语义（P7 必须清楚）**：

| 值 | 含义 |
| --- | --- |
| 0 | 初始值，还未初始化 |
| -1 | 正在初始化（CAS 竞争） |
| -(1+n) | 正在扩容，低 16 位记录参与扩容的线程数 n |
| >0 | 初始化后 = 下一次扩容阈值（0.75 × table.length） |


**扩容时的多线程协助**：JDK8 将扩容任务拆分为多个 stride（步长），每个线程通过 CAS 竞争 `transferIndex` 来领取迁移任务段。这是区别于 JDK7 单线程扩容的核心优化。

---

### Q8：如何发现和定位死锁？死锁预防策略有哪些？
**A：**

**1. 发现死锁三种方式**

```plain
① jstack <pid>
   └─ 自动检测: Found one Java-level deadlock
   └─ 列出互相等待的线程 + 锁对象地址

② JConsole / VisualVM → "检测死锁" 按钮 → 图形化展示

③ 编程检测:
   ThreadMXBean bean = ManagementFactory.getThreadMXBean();
   long[] deadlockedThreads = bean.findDeadlockedThreads();
   long[] monitorDeadlocked = bean.findMonitorDeadlockedThreads();
   // 定时任务中检测 + 告警
```

**2. 死锁四个必要条件**

```plain
① 互斥: 资源不能共享，只能独占
② 持有并等待: 持有资源的同时等待其他资源
③ 不可剥夺: 已获取的资源不能被强制释放
④ 循环等待: 存在线程→资源的环形等待链

打破任意一个即可预防死锁
```

**3. 死锁预防策略（P7 实践）**

| 策略 | 打破条件 | 实现 |
| --- | --- | --- |
| **固定加锁顺序** | ④ 循环等待 | 🏆 最实用：所有线程按相同顺序获取锁（如按 id 升序） |
| **tryLock + 超时** | ② 持有并等待 | `lock.tryLock(1, SECONDS)` → 获取不到就释放已持有的重试 |
| **一次性获取所有锁** | ② 持有并等待 | `Redisson.getMultiLock(lock1, lock2)` |
| **无锁编程** | ① 互斥 | CAS / 不可变对象 / 线程局部变量 |


---

### Q9：高并发下如何选择乐观锁与悲观锁？CAS 的 ABA 问题如何解决？
**A：**

**1. 两种锁的本质区别**

```plain
悲观锁: "别人会改，我先锁住"
  └─ 加锁 → 读 → 改 → 写 → 解锁
  └─ 写多读少、冲突概率高 → 避免 CAS 自旋浪费 CPU

乐观锁: "别人不会改，改完再检查"
  └─ 读 → 改 → CAS校验 → (成功/重试)
  └─ 读多写少、冲突概率低 → 无锁等待，吞吐量高
```

**2. CAS 的 ABA 问题**

```plain
初始: A
线程1: 读 A → 准备 CAS(A→C)
线程2: CAS(A→B) → CAS(B→A)  ← A 回来了！但中间经过 B
线程1: CAS(A→C) 成功！ ← 线程1 不知道 A 已经被改过

解决方案: AtomicStampedReference（引用 + stamp 版本号）
```

**3. 选型决策矩阵（P7 核心）**

| 场景 | 方案 | 理由 |
| --- | --- | --- |
| 内存自增计数器 | `AtomicLong` CAS | 无锁，单变量，冲突可控 |
| 秒杀库存扣减 | Redis Lua 原子扣减 | 内存级 + 原子操作 > DB 锁 |
| 金融账户转账 | 数据库悲观锁 `SELECT FOR UPDATE` | 强一致性，不可重试 |
| 订单状态变更 | 数据库乐观锁 version | 冲突概率低，避免锁等待 |
| 并发 Map 写入 | ConcurrentHashMap CAS+synchronized | 细粒度锁，高性能 |


---

### Q10：如果让你基于 AQS 自定义一个同步组件，你会怎么做？
**A：**

**1. AQS 模板方法模式**

```plain
自定义同步器只需要实现:
  独占模式: tryAcquire / tryRelease          → ReentrantLock 风格
  共享模式: tryAcquireShared / tryReleaseShared → Semaphore 风格
  isHeldExclusively                         → 判断是否独占

不需要处理: 排队、阻塞、唤醒、取消 → AQS 全部帮你做好！
```

**2. 实战示例：可超时的二元信号量**

```java
public class TimeoutBinarySemaphore {
    private final Sync sync = new Sync();

    public boolean tryAcquire(long timeout, TimeUnit unit) {
        return sync.tryAcquireSharedNanos(1, unit.toNanos(timeout));
    }
    public void release() { sync.releaseShared(1); }

    static class Sync extends AbstractQueuedSynchronizer {
        Sync() { setState(1); }  // 1=可用

        @Override
        protected int tryAcquireShared(int acquires) {
            for (;;) {
                int current = getState();
                if (current == 0) return -1;  // 获取失败，排队
                if (compareAndSetState(1, 0)) return 1;
            }
        }

        @Override
        protected boolean tryReleaseShared(int releases) {
            for (;;) {
                if (getState() != 0) return false;
                if (compareAndSetState(0, 1)) return true;
            }
        }
    }
}
```

**3. P7 扩展**：基于 AQS 可实现优先级排队锁（修改 Node 插入位置）、支持回调的锁（释放前执行钩子）、链式锁（获取 A 锁时自动获取 B 锁的包裹器）等。

---

### Q11（新增 — CompletableFuture）：Java 异步编程最佳实践与线程池隔离？
**A：**

**1. 异步编排核心 API**

```plain
创建:
  CompletableFuture.supplyAsync(() -> result, executor)  // 有返回值
  CompletableFuture.runAsync(() -> {}, executor)          // 无返回值

编排:
  thenApply(fn):     同步转换结果（同线程）
  thenApplyAsync(fn): 异步转换（用线程池）
  thenCompose(fn):   扁平化组合（fn 返回 CompletableFuture）
  thenCombine(cf, fn): 合并两个 Future 的结果

异常处理:
  exceptionally(ex -> fallback):  仅处理异常
  handle((result, ex) -> ...):    正常+异常都处理
  whenComplete((result, ex) -> {}): 不改变结果，仅副作用（类似 finally）
```

**2. 线程池隔离原则**

```java
// ❌ 错误: 所有异步都用公共 ForkJoinPool
CompletableFuture.supplyAsync(() -> ioOperation());

// ✅ 正确: IO 密集和 CPU 密集用不同线程池
Executor ioPool = Executors.newFixedThreadPool(50);
Executor cpuPool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());

CompletableFuture.supplyAsync(() -> ioOperation(), ioPool);
CompletableFuture.supplyAsync(() -> cpuCalculation(), cpuPool);
```

**3. 常见陷阱**

| 陷阱 | 对策 |
| --- | --- |
| **get() 阻塞** | 用 `thenAccept` 或 `allOf().join()` |
| **异常吞没** | 必须加 `exceptionally` 或 `handle` |
| **默认线程池** | 🏆 始终显式指定线程池 |
| **无限等待** | 加 `orTimeout` 或 `completeOnTimeout` |


---

### Q12（新增 — 伪共享与高性能队列）：什么是伪共享？Disruptor 如何实现高性能？
**A：**

**1. 伪共享（False Sharing）**

```plain
CPU 缓存行（Cache Line）通常 64 字节:

┌─────────────── Cache Line (64B) ───────────────┐
│ Thread A 写 X │  Thread B 写 Y │  ...          │
└────────────────────────────────────────────────┘

如果 X 和 Y 在同一缓存行:
  A 写 X → A 的缓存行失效 → B 的缓存行也失效
  B 写 Y → B 的缓存行失效 → A 的缓存行也失效
  → 大量回写主存 → 性能退化至 ~内存速度！
```

**2. 解决方案：@Contended 注解**

```java
// JDK8+（需 JVM 参数 -XX:-RestrictContended）
@sun.misc.Contended
public class PaddedCounter {
    public volatile long value;
}
// ConcurrentHashMap 内部使用 @Contended 保护 counterCells
```

**3. Disruptor 高性能队列**

```plain
传统 ArrayBlockingQueue 瓶颈:
  ① 每次 put/take 都要加锁
  ② GC 不断创建/回收节点对象
  ③ 伪共享

Disruptor 优化:
  ① 环形数组(RingBuffer)预分配 → 无 GC
  ② 无锁 CAS 竞争序列号
  ③ 缓存行填充 → 消除伪共享
  ④ 单生产者模式 → 无 CAS，仅写 volatile
  ⑤ 批处理消费 → 减少 CAS 次数
```

**适用场景**：日志框架（Log4j2）、高频交易、事件驱动架构。

---

### Q13（新增 — CHM 扩容与 JDK7 并发问题）：ConcurrentHashMap 的扩容 rehash 机制是怎样的？JDK7 的 HashMap/CHM 有哪些并发问题？
**A：**

**1. 1.8 扩容触发条件**

+ `addCount` 后检查：元素数 ≥ sizeCtl（阈值 = 0.75 × n）→ 触发扩容（容量翻倍）。
+ 链表长度 > 8 且数组长度 < 64 → **优先扩容而不是树化**。
+ put 时发现槽位是 ForwardingNode → 其他线程 `helpTransfer` 参与协助扩容。

**2. 扩容完整流程（transfer）**

```plain
① 发起扩容: 第一个线程 CAS 修改 sizeCtl 为负数
   （高16位=扩容戳，低16位=参与线程数+1），创建 2 倍容量新数组
② 迁移分区: transferIndex 从原数组尾部向前分配迁移区间
   每个线程 CAS 竞争 transferIndex -= stride（步长，默认 ≥16 个桶）
   → 多线程同时迁移不同区间（并发扩容的关键！）
③ 单桶迁移:
   - 桶为空 → CAS 放置 ForwardingNode（转发节点，指向新数组）
   - 桶为链表 → 按 hash & n 拆分为低位链(ln)/高位链(hn)
     ln 位置不变 i，hn 位置 i+n → 尾插保持相对顺序
   - 桶为红黑树 → 同样拆两棵，小树退化为链表（untreeify 阈值 6）
④ 迁移完成的桶打上 ForwardingNode；全部完成后替换 table 引用，
   sizeCtl 恢复为 0.75 × 新容量
⑤ 并发安全:
   读请求 get() 遇到 ForwardingNode → find() 到新数组继续查，读不阻塞
   写请求遇到 ForwardingNode → helpTransfer 先协助扩容再写
   未迁移的桶 → put 与 transfer 竞争桶头 synchronized 锁，不会同时写和迁移
```

**3. sizeCtl 多重语义（面试必背）**

| 值 | 含义 |
| --- | --- |
| 0 | 未初始化 |
| -1 | 正在初始化（CAS 竞争） |
| -(1+n) | 正在扩容，低 16 位记录参与扩容的线程数 n |
| >0 | 初始化后 = 下一次扩容阈值（0.75 × table.length） |


**4. 为什么迁移能无锁拆分链表？** 扩容只按 hash 的最高位（hash & n）分两段，不重算 hash；原链表相对顺序用尾插保持；各线程迁移不同区间互不干扰，只需 CAS 协调 transferIndex——这是 1.8 相比 1.7 单线程扩容的核心优化。

**5. JDK7 的并发问题**

**5.1 HashMap 1.7 死循环（经典事故）**

+ 1.7 HashMap **头插法** + 多线程同时 transfer → 迁移后链表可能**成环** → get() 死循环、CPU 100%。
+ 根本原因：无并发控制，transfer 时对共享链表做头插反转。
+ 解决：多线程共享 Map 用 CHM；HashMap 本身不承诺线程安全（1.8 改尾插后死循环消失，但数据覆盖/丢失问题仍在）。

**5.2 ConcurrentHashMap 1.7 的机制与局限**

+ 设计：Segment 数组（默认 16 段，每段一个 ReentrantLock）+ HashEntry，按 key 哈希定位 Segment 后加锁——锁粒度 = 段级，所以**不会**出现 HashMap 的并发成环。
+ **size() 的坑**：遍历所有 Segment 求和；先不加锁统计 3 次（对比 modCount），不一致才全 Segment 加锁重算——所以 size() 是弱一致、且偶发性能抖动。
+ 局限：① 锁粒度粗（段级），段内热点仍串行 ② 内存开销（Segment 数组 + 空段占空间）③ size/containsValue 弱一致 ④ 无 compute 类原子操作。

**6. 1.8 vs 1.7 改进总结**

| 维度 | 1.7 | 1.8 |
| --- | --- | --- |
| 锁 | Segment + ReentrantLock | 桶头 synchronized + CAS |
| 结构 | Segment 数组 + HashEntry | Node 数组 + 链表/红黑树 |
| 扩容 | 段内独立扩容 | 多线程协助扩容（transferIndex 分工） |
| 计数 | size() 遍历段求和 | counterCells 分摊，size 更接近实时 |
| 粒度 | 段级 | 桶级 |


**高频追问**：

| 问题 | 答案 |
| --- | --- |
| 为什么 1.8 用 synchronized 替代 ReentrantLock？ | 锁粒度已细化到桶级，竞争大幅降低；JVM 对 synchronized 的偏向锁/锁升级优化成熟，代码更简洁 |
| 扩容期间读写会阻塞吗？ | 读不阻塞（ForwardingNode 转发到新数组）；写通过 helpTransfer 协助扩容，扩容更快完成 |
| 1.7 CHM 的 size() 为什么不精确？ | 先 3 次无锁统计（省去全段加锁代价），并发修改时结果本身就在变化——弱一致是刻意取舍 |
| 链表树化阈值为什么是 8？ | 泊松分布下 8 个节点的碰撞概率约千万分之一，正常 hash 分布几乎不会树化；且扩容优先于树化 |


---

### Q14（新增 — JMM 与 volatile）：Java 内存模型是什么？volatile 的可见性和有序性如何保证？为什么 volatile 不能保证原子性？
**A：**

**1. JMM（Java Memory Model）三大特性**

```plain
① 可见性: 一个线程对共享变量的修改，其他线程能立即看到
   └─ JMM 抽象: 每个线程有本地内存(工作内存)，共享变量在主内存
   └─ 实际: CPU 缓存(MESI 协议) + 编译器/处理器优化导致不同步

② 原子性: 一个操作不可分割
   └─ JVM 保证基本类型的读写是原子的（long/double 在 32 位 JVM 分两次）
   └─ i++ 不是原子操作（读-改-写三步）

③ 有序性: 程序按代码顺序执行（指令重排序会打破）
   └─ 重排序前提: as-if-serial（单线程语义不变）+ happens-before
```

**2. happens-before 规则（面试必背核心）**

```plain
① 程序顺序规则: 同一线程内前面的操作 happens-before 后面的
② volatile 规则: volatile 写 happens-before 后续的 volatile 读
③ 锁规则: unlock happens-before 后续的 lock
④ 传递性: A hb B, B hb C → A hb C
⑤ start/join 规则: 线程 start 前的操作 hb 线程内操作；线程内操作 hb join 返回
⑥ 中断规则: interrupt() hb 被中断线程检测到中断
```

**3. volatile 语义**

```plain
① 可见性: 写 volatile 变量后，立即刷回主内存（Lock 前缀指令）
   读 volatile 变量时，从主内存重新读取（缓存行失效）

② 有序性: 通过内存屏障禁止重排序
   StoreStore 屏障: 禁止普通写与 volatile 写重排
   StoreLoad 屏障: 禁止 volatile 写与后续读/写重排（最强屏障）
   LoadLoad/LoadStore: 禁止读侧重排

③ 不能保证原子性: i++ = 读 + 改 + 写三步，volatile 只保证单步的可见性
   → 两个线程同时 i++ 仍会丢更新 → 需要 AtomicInteger(CAS) 或锁
```

**4. volatile vs synchronized**

| 维度 | volatile | synchronized |
| --- | --- | --- |
| 原子性 | ❌ 不保证 | ✅ 保证 |
| 可见性 | ✅ | ✅ |
| 有序性 | ✅（部分，禁止重排） | ✅ |
| 阻塞 | ❌ 无锁 | ✅ 会阻塞 |
| 场景 | 状态标志位、DCL 单例 | 复合操作、临界区 |


**5. DCL 单例为什么必须加 volatile**

```java
public class Singleton {
    private static volatile Singleton instance;  // ← 必须 volatile
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) instance = new Singleton();
            }
        }
        return instance;
    }
}
```

```plain
new Singleton() 三步: ① 分配内存 ② 初始化对象 ③ instance 指向内存
没有 volatile → ②③ 可能重排 → 另一个线程看到非 null 但未初始化的对象
volatile 的 StoreLoad 屏障 → 禁止 ②③ 重排 → 读到的必然是完整对象
```

---

### Q15（新增 — 线程基础高频追问）：线程的状态转换？sleep 与 wait 的区别？interrupt 如何工作？如何正确停止线程？shutdown 与 shutdownNow 的区别？
**A：**

**1. 线程 6 状态转换**

```plain
NEW →(start)→ RUNNABLE ⇄ BLOCKED（等 synchronized 锁）
                     ⇄ WAITING（wait/join/park 无限期等）
                     ⇄ TIMED_WAITING（sleep/wait(timeout) 限期等）
RUNNABLE/阻塞态 →(执行完)→ TERMINATED

注意: BLOCKED 是等锁（被动），WAITING 是等通知（主动 wait）——
面试高频区分点！
```

**2. sleep 与 wait 对比**

| 维度 | sleep | wait |
| --- | --- | --- |
| 所属 | Thread 静态方法 | Object 实例方法 |
| 锁释放 | ❌ 不释放锁 | ✅ 释放锁 |
| 唤醒 | 时间到自动醒 | notify/notifyAll |
| 调用位置 | 任何地方 | 必须在 synchronized 内 |
| 中断 | 抛 InterruptedException | 抛 InterruptedException |


**3. interrupt 机制**：调用 `interrupt()` 只设置中断标志（布尔值），**不会强制停止线程**；线程在 sleep/wait/join/park 等阻塞方法中会抛出 InterruptedException 并**清除中断标志**；正常运行时线程自行检查 `isInterrupted()` 决定是否退出。已废弃 `Thread.stop()`（强制停止，破坏原子性）。

**4. 正确停止线程**：协作式停止——① 中断标志 + 检查 ② 守护线程 + volatile 标志位 ③ 循环任务用 interrupt + 捕获 InterruptedException 退出。禁止 stop/suspend。

**5. notify vs notifyAll**：都只能唤醒等待该锁的线程，且唤醒哪个由 JVM 决定（不确定）。notify 唤醒**一个**（可能饿死）；notifyAll 唤醒**全部**（竞争锁，安全但开销大）。多条件等待场景用 notifyAll，单等待者场景可用 notify。

**6. 线程间通信方式**：① 共享变量 + volatile/synchronized（最基础）② wait/notify ③ Lock + Condition（多条件）④ 并发工具（CountDownLatch/CyclicBarrier/Semaphore/BlockingQueue）⑤ join 等待线程结束。

**7. shutdown vs shutdownNow**：shutdown 关闭提交入口（新任务拒绝），**已提交任务继续执行完**；shutdownNow 尝试中断正在执行的任务，**返回队列中未执行的任务列表**，不保证一定停止。都不能强制终止执行中的任务（除非任务响应中断）。

**8. 场景题速答**：

+ **两个线程各对 int 加 50 次，结果范围**：2~100。无同步时 i++ 三步非原子，最坏互相覆盖只剩 50+1 次生效（下限 2 次）；用 AtomicInteger 才是 100。
+ **多线程打印奇偶数**：wait/notify + 共享状态位（或 Condition 接力），奇数线程打印后唤醒偶数线程。
+ **3 个线程并发、1 个线程等全部完成**：CountDownLatch(3)，主线程 await。

---

## 🎯 P7 面试之 STAR 映射：把知识变成故事
| 知识点 | STAR 锚点 | 一句话 |
| --- | --- | --- |
| synchronized | 锁优化排查 | "大促前压测发现同步块瓶颈，排查后使用 ReentrantLock 多条件变量替代 wait/notify，p99 降低 60%" |
| AQS | 自定义同步组件 | "业务需要支持优先级的排他锁，基于 AQS 扩展了 PriorityNode 插入逻辑" |
| 线程池 | 线程池调优 | "订单服务线程池队列积压导致超时，改为 SynchronousQueue + CallerRunsPolicy 后超时率归零" |
| ThreadLocal | 内存泄漏修复 | "用户信息在异步调用链中丢失，用 TransmittableThreadLocal 替代 InheritableThreadLocal" |
| ConcurrentHashMap | 并发缓存设计 | "用 CHM 替代 Hashtable 后缓存读取 QPS 提升 10 倍，利用 computeIfAbsent 原子加载" |
| CompletableFuture | 异步编排优化 | "商品详情页 5 个 RPC 并行调用，用 allOf 编排后 RT 从 500ms 降到 80ms" |
| 乐观锁 | 并发扣库存 | "下单扣库存从悲观锁改为 Redis Lua + 乐观版本号，QPS 从 2000 提升到 50000" |
| 伪共享 | 性能极致优化 | "压测发现计数器瓶颈，通过 @Contended 注解消除伪共享后吞吐量翻倍" |
| volatile | 可见性排查 | "线程停止标志位不加 volatile 导致停机指令丢失，加 volatile 后故障归零" |
| 线程基础 | 线程停止改造 | "老代码用 Thread.stop 导致数据不一致，改为 interrupt 协作式停止后运行一年无异常" |


---

## 📚 扩展阅读
+ 《Java 并发编程的艺术》 — 第3章（Java内存模型）、第5章（J.U.C）
+ 《Java 并发编程实战》 — 第13章（显式锁）、第14章（同步工具类）
+ OpenJDK 源码 — `AbstractQueuedSynchronizer`、`ConcurrentHashMap`
+ Disruptor 白皮书 — LMAX 架构
+ 美团技术博客 — Java 并发编程系列
+ 小林coding — Java 并发编程面试题（多线程/JMM/volatile/AQS/线程池/场景）

