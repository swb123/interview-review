# 一、Java 语言核心与高级特性
> **目标岗位：阿里 P7 后端开发**  
P7 核心能力要求：能结合源码推导边界行为、能从字节码/JVM 层面解释语言特性、能指导团队避坑。
>

---

## 知识体系总览
```plain
Java 语言核心与高级特性
├── 集合源码
│   ├── HashMap（1.7 头插法→1.8 尾插法+红黑树、扩容死循环、扰动函数）
│   ├── ConcurrentHashMap（1.7 Segment→1.8 CAS+synchronized、sizeCtl）
│   └── ArrayList/LinkedList（扩容机制、fail-fast 原理）
├── JVM 层面的语言特性
│   ├── 多态（静态分派 vs 动态分派、invokevirtual vs invokeinterface）
│   ├── 泛型擦除（桥方法、类型边界、协变与逆变）
│   ├── 注解（运行时反射 vs 编译时 APT、AbstractProcessor）
│   └── Lambda（invokedynamic、LambdaMetafactory、vs 匿名内部类）
├── 字节码与异常
│   └── try-finally-return 的执行顺序（字节码层面分析）
├── IO 与网络
│   └── BIO/NIO/AIO、Netty 线程模型（Reactor 主从模式）
├── Stream 与函数式编程
│   └── Stream 操作链（惰性求值/短路/并行流）、Collector、Spliterator
├── 常用设计模式
│   └── 单例/工厂/策略/观察者 — 在 Spring 源码中的体现
└── Java 新特性
    └── Record/Sealed Class/Virtual Thread（JDK17~21 P7 必问）
```

**P6 vs P7 回答层次：**

| 维度 | P6 回答 | P7 回答 |
| --- | --- | --- |
| HashMap | 说出数组+链表+红黑树 | 能分析 1.7 头插法死循环成因、解释扰动函数设计、给出容量规划公式 |
| ConcurrentHashMap | 说出分段锁→CAS+synchronized | 能分析 sizeCtl 多重语义、解释多线程协助扩容、对比 JDK7 性能差异 |
| 多态 | 说出静态分派/动态分派 | 能结合字节码指令（invokevirtual/interface/special）分析方法调用 |
| 泛型 | 说出类型擦除 | 能分析桥方法生成规则、PECS 原则、协变逆变场景 |
| Lambda | 说出匿名内部类区别 | 能解释 invokedynamic + LambdaMetafactory 的 Bootstrap 机制 |


---

## 参考资源
+ 《Java 编程思想》 — 第15章（泛型）、第18章（IO）
+ 《深入理解 Java 虚拟机》第3版 — 第8章（字节码执行引擎）
+ OpenJDK 源码 — HashMap / ConcurrentHashMap
+ Netty 官方文档 — Reactor 线程模型
+ JEP 425 — Virtual Threads (JDK 21)

---

### Q1：HashMap 在 JDK1.7 和 1.8 中的数据结构有何不同？为什么引入红黑树？为什么线程不安全？
**A：**

**1. 数据结构演进**

```plain
JDK1.7: 数组 + 单向链表（头插法）
JDK1.8: 数组 + 链表/红黑树（尾插法）
```

| 维度 | JDK 1.7 | JDK 1.8 |
| --- | --- | --- |
| 结构 | 数组 + 链表 | 数组 + 链表 + 红黑树 |
| 插入方式 | 头插法（新节点在表头） | 尾插法（新节点在表尾） |
| 树化阈值 | — | 链表长度 ≥ 8 + table ≥ 64 |
| 退化阈值 | — | 树节点 ≤ 6 → 转回链表 |
| 扩容重哈希 | rehash 遍历重新计算 | 高低位拆分（原索引 or 原索引+oldCap） |
| 扰动函数 | hash ^ (hash >>> 20) ^ (hash >>> 12) 多次扰动 | hash ^ (hash >>> 16) 一次扰动 |


**为什么引入红黑树？** 链表查询 O(n)，当哈希冲突严重时（链表 > 8），查询从 O(1) 退化到 O(n)。红黑树 O(log n) 保证极端情况下的性能底线。

**为什么树化阈值是 8？** Poisson 分布概率：链表长度=8 的概率 ≈ 0.000006%（即 1/10^7）。正常情况下几乎不会树化——但攻击者构造哈希碰撞时可以，因此树化是安全兜底。

**2. JDK7 头插法扩容死循环**

```plain
线程A: resize() → newTable → 开始迁移 a→b→c
线程B: resize() → newTable → 迁移完成 a←b←c（头插法反转了顺序！）
线程A: 继续用旧顺序 → 形成 a↔b 环 → get() → 死循环！

JDK8 解决方案: 尾插法（保持原顺序）+ 高低位拆分 → 线程间互不干扰
```

**3. 线程安全的替代方案**

| 方案 | 适用场景 |
| --- | --- |
| `ConcurrentHashMap` | 🏆 并发读写 |
| `Collections.synchronizedMap()` | 低并发（全局锁） |
| `Hashtable` | ❌ 已淘汰 |


---

### Q2：ConcurrentHashMap 在 1.7 和 1.8 中分别如何保证线程安全？为什么 1.8 放弃分段锁？
**A：**

**1. JDK7 Segment 分段锁**

```plain
16 个 Segment（默认），每个 Segment 继承 ReentrantLock
每个 Segment 维护一个 HashEntry[]，独立加锁
并发度 = Segment 数量（默认 16）

size() 计算: 先不加锁累加两次 → 结果一致返回 → 不一致则全加锁再算
```

**2. JDK8 放弃 Segment 的原因**

```plain
① JDK7 Segment 锁粒度仍偏粗：一个 Segment 锁住多个槽位
② JDK8 synchronized 优化（偏向→轻量级→重量级升级 + 锁消除/粗化）
   → synchronized 性能在低竞争下已优于 ReentrantLock
③ JDK8 细粒度锁：每个槽位独立锁 → 并发度 = table 长度
④ 多线程协助扩容：更灵活的扩容并发
```

**3. JDK8 写入流程**

```plain
① 槽位为空 → CAS 插入（无锁）
② 槽位非空（非 ForwardingNode）→ synchronized(头节点) → 链表尾插或红黑树插入
③ 槽位是 ForwardingNode → 正在扩容 → helpTransfer() 帮助迁移
```

**4. sizeCtl 多重语义** — 详见「三、并发编程 Q7」。

---

### Q3：ArrayList 的扩容机制？遍历时删除元素的安全方式？
**A：**

**1. 扩容机制**

```java
// grow() → newCapacity = oldCapacity + oldCapacity >> 1 = 1.5 倍
// Arrays.copyOf() 底层 System.arraycopy() → native，高效
// 最大 Integer.MAX_VALUE - 8
```

**为什么扩容 1.5 倍？** 比 2 倍省内存（减少约 33% 浪费），又比每次+1 减少扩容频次。

**2. fail-fast 机制**

```plain
modCount: 记录结构变更次数（add/remove）
迭代器创建时记录 expectedModCount = modCount
每次 next()/remove() 检查 expectedModCount == modCount
不一致 → ConcurrentModificationException

安全删除:
① Iterator.remove() ← 同步更新 expectedModCount ✅
② CopyOnWriteArrayList ← 弱一致性，迭代期间写入不影响迭代器 ✅
③ Stream.filter() + collect() ← 创建新 List，不修改原 List ✅
```

---

### Q4：多态在 JVM 中的实现原理？静态分派与动态分派？
**A：**

**1. 方法调用指令对照**

| 指令 | 含义 | 分派类型 | 示例 |
| --- | --- | --- | --- |
| `invokespecial` | 构造器/私有方法/父类方法 | 静态（编译期确定） | `super.method()` |
| `invokestatic` | 静态方法 | 静态 | `Math.abs()` |
| `invokevirtual` | 普通虚方法 | 动态（运行时根据 receiver） | `obj.method()` |
| `invokeinterface` | 接口方法 | 动态 | 通过接口调用 |
| `invokedynamic` | 动态语言支持/Lambda | 动态（由 Bootstrap 方法决定） | Lambda 表达式 |


**2. 静态分派 vs 动态分派**

```plain
静态分派（编译期）: 方法重载 → 根据参数的静态类型选择方法
  └─ Human man = new Man(); sayHello(man) → 调用 sayHello(Human)
  └─ 因为重载方法的参数类型在编译期就确定了

动态分派（运行时）: 方法重写 → 根据 receiver 的实际类型选择方法
  └─ man.sayHello() → 调用 Man.sayHello()（invokevirtual 查虚方法表）
```

**3. 虚方法表（vtable）**

```plain
Man 类的 vtable:
  toString() → Man.toString()（重写）或 Object.toString()（未重写）
  sayHello() → Man.sayHello()
  ...

invokevirtual 流程: 对象引用 → 查对象头 → Klass → vtable → 找到实际方法
```

---

### Q5：泛型擦除是什么？桥方法如何工作？PECS 原则？
**A：**

**1. 类型擦除规则**

```java
// 编译前:
List<String>  →  编译后: List
<T> → Object（无界）
<T extends Number> → Number（上界）

// 问题:
List<String> list = new ArrayList<>(); list.add("hello");
// 字节码中实际是: ((String) list.get(0)) ← checkcast 指令插入类型转换
```

**2. 桥方法 — 解决擦除后的多态问题**

```java
class MyList implements Comparable<MyList> {
    public int compareTo(MyList o) { ... }  // 实际方法
}
// 擦除后 Comparable 接口的 compareTo 参数是 Object
// → 编译器自动生成桥方法:
public int compareTo(Object o) {
    return compareTo((MyList) o);  // 转发到实际方法
}
```

**3. PECS 原则**

```plain
Producer Extends, Consumer Super

协变 ? extends T:  只能读不能写（读出来的类型是 T）
逆变 ? super T:    只能写不能读（T 及子类可写入）
无界 ? :           只能读，读出来是 Object

List<? extends Number> nums → nums.get(0) → Number ✅ / nums.add(1) → ❌
List<? super Integer> ints → ints.add(1) → ✅ / ints.get(0) → Object（丢失类型）
```

---

### Q6：注解的运行原理是什么？运行时注解 vs 编译时注解？
**A：**

**1. 运行时注解（如 @Transactional）**

```plain
Spring 扫描 Bean → 反射获取 Method.getAnnotation(@Transactional)
→ 判断是否有事务配置 → 创建 AOP 代理 → 拦截器链中执行事务逻辑

实现步骤:
① @Retention(RetentionPolicy.RUNTIME) ← 保留到运行时
② 通过 Reflection API 在运行时读取注解元数据
③ 根据注解属性执行对应的逻辑
```

**2. 编译时注解（如 Lombok）**

```plain
Lombok @Getter → 编译期 AST 转换 → 字节码中直接生成 getXxx() 方法
→ 运行时已经和手写的一样了，零运行时开销

实现步骤:
① @Retention(RetentionPolicy.SOURCE) ← 仅保留源码
② 实现 AbstractProcessor (javax.annotation.processing)
③ 通过 Java Compiler API 操作 AST（如 Lombok 用内部 API）
④ 在编译阶段生成新的 AST 节点（如新增方法）
```

**3. 运行时 vs 编译时**

| 维度 | 运行时（Reflection） | 编译时（APT/AST） |
| --- | --- | --- |
| 代表 | Spring, MyBatis | Lombok, MapStruct |
| 性能 | 有反射开销 + 代理 | 🏆 零运行时开销 |
| 侵入性 | 对源码无侵入 | 可能改变字节码 |
| 复杂度 | 低 | 高（需要理解编译器 API） |


---

### Q7：Lambda 表达式的底层实现原理？它和匿名内部类有什么区别？
**A：**

**1. Lambda 的核心: invokedynamic**

```plain
匿名内部类: 编译时生成 Xxx$1.class（独立 .class 文件） → new 创建实例

Lambda:     编译时生成私有静态方法(lambda$main$0) + invokedynamic 指令
            → 运行时由 LambdaMetafactory 动态生成函数式接口实现类
            → 但不是每次调用都生成新类！是缓存在 CallSite 中的
```

**2. 二者核心区别**

| 维度 | 匿名内部类 | Lambda |
| --- | --- | --- |
| 实现方式 | 编译期生成匿名 .class 文件 | invokedynamic + LambdaMetafactory 动态生成 |
| this 含义 | 匿名内部类对象本身 | 外层类的 this（没有自己的 this） |
| 实例创建 | 每次 new 一个新对象 | 无状态时返回单例，有状态时才创建新对象 |
| 类文件 | 额外 .class | 不生成额外 .class |
| 包私有方法访问 | ✅ | ❌（Lambda 生成的方法不能调用包私有方法） |


**3. why Lambda 无状态是单例**

```plain
(x) -> System.out.println(x)  ← 不捕获外部变量 → LambdaMetafactory 返回同一个实例
(x) -> this.field              ← 捕获 this → 每次都创建新实例
```

---

### Q8：try-finally 中带有 return 语句的执行顺序？
**A：**

**1. 核心规则**

```plain
① finally 一定会执行（除非 System.exit() 或 JVM crash）
② finally 中有 return → 覆盖 try 中的 return
③ try 中 return 表达式先计算，再执行 finally，最后 return
```

**2. 经典陷阱**

```java
// 错！以为返回 2
public int test() {
    int x = 1;
    try { return x; }          // return 1 ← 先计算 x=1 并暂存
    finally { x = 2; }         // 修改 x=2，但返回的是已暂存的 1！
}
// 返回: 1

// 更隐蔽:
public int test2() {
    try { return 1; }          // 暂存 1
    finally { return 2; }      // finally 覆盖了 try 的 return！
}
// 返回: 2
```

**3. 字节码分析**

```plain
try { return x; } finally { ... }
字节码:
  iload_1              ← 加载 x=1 到操作数栈
  istore_2             ← 暂存到局部变量 slot2（为了 finally 先不 return）
  finally 的字节码执行
  iload_2              ← 从 slot2 加载暂存值
  ireturn              ← return 暂存值
```

> **P7 原则**：finally 块中禁止 return！Alibaba 规范强制要求。
>

---

### Q9：BIO、NIO、AIO 的区别？Netty 线程模型？
**A：**

**1. 三种 IO 模型**

| 模型 | 原理 | 阻塞点 | 线程消耗 | 适用 |
| --- | --- | --- | --- | --- |
| **BIO** | 每个连接一个线程，读写全阻塞 | accept/read/write 全阻塞 | 1连接=1线程 | 连接少且固定 |
| **NIO** | Selector 单线程轮询多个 Channel 的事件 | 仅 select() 阻塞 | 少量线程管理大量连接 | 🏆 高并发 IO |
| **AIO** | 操作系统回调通知（IOCP/epoll ET） | 全异步，无阻塞点 | 回调线程池 | Windows 或 Linux 高吞吐 |


**2. Netty Reactor 主从线程模型**

```plain
┌───────────────┐
│ Boss EventLoopGroup (1~N 个线程)  │
│ 只负责 accept() 接收连接          │
│ 将新建的 Channel 注册到 Worker    │
└───────┬───────┘
        │ 注册
        ▼
┌───────────────┐
│ Worker EventLoopGroup (N 个线程)  │
│ 负责 read/decode/process/encode/write │
│ 每个 Channel 绑定到固定的 EventLoop  │
└───────────────┘

EventLoop 绑定关系: Channel -> EventLoop -> Thread(永久绑定)
Pipeline: inbound handler → business handler → outbound handler（责任链模式）
```

**3. I/O 多路复用（select/poll/epoll 演进）**

+ **select**：fd_set 位图，上限 1024；每次调用需全量拷贝 fd 集合到内核，内核 O(n) 轮询，返回后应用再 O(n) 遍历——两次遍历 + 两次拷贝。
+ **poll**：pollfd 数组替代位图，无 1024 上限，但仍是全量拷贝 + 内核轮询，连接多了性能一样差。
+ **epoll**（Linux 首选）：epoll_ctl 注册事件（一次拷贝）、内核用红黑树+就绪链表维护，epoll_wait 只返回**就绪**的 fd（O(就绪数)）——没有两次遍历；支持 ET（边缘触发，只通知一次，需一次读完）/ LT（水平触发，默认）。

```plain
select/poll: 用户态→内核 全量拷贝 fd → 内核遍历所有 fd → 返回整个集合 → 用户态再遍历
epoll:       注册时拷贝一次 → 内核事件驱动把就绪 fd 挂到就绪链表 → wait 只取就绪的
```

**4. Netty 零拷贝**

```plain
① CompositeByteBuf: 组合多个 ByteBuf，不复制数据
② FileRegion.transferTo(): 文件直接通过 DMA 发送到 Socket（sendfile 系统调用）
③ Slice: 共享同一段内存区域，不复制
```

---

### Q10：Record、Sealed Class 和 Virtual Thread 解决了什么问题？
**A：**

**1. Record (JDK 14+) — 纯数据载体**

```java
// 以前:
public class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public int x() { return x; }  public int y() { return y; }
    public boolean equals(Object o) { ... }
    public int hashCode() { ... }
    public String toString() { ... }
}

// Record 一行搞定:
public record Point(int x, int y) { }
// 自动生成: 构造器、访问器 x()/y()、equals/hashCode/toString
// 不可变、final、不能继承、适合 DTO/VO/配置
```

**2. Sealed Class (JDK 17) — 受控继承**

```java
sealed interface Result permits Success, Failure { }
record Success(String data) implements Result { }
record Failure(String error) implements Result { }

// 优点: pattern matching switch 可以穷举所有子类 → 编译期发现遗漏
// 典型场景: 代数数据类型 (ADT)、API 返回值、状态机
```

**3. Virtual Thread (JDK 21, Project Loom) — 颠覆线程模型**

```plain
平台线程 (Platform Thread): 1:1 映射到 OS 线程 → 创建/切换成本高 → 最多几千个
虚拟线程 (Virtual Thread):   JVM 管理 → 创建成本极低 → 可百万级!
   阻塞时 → 自动 unmount(释放平台线程) → 恢复时 mount → 无阻塞浪费

适用: IO 密集型（数据库查询/HTTP 调用），CPU 密集型不适合

// 创建虚拟线程:
Thread.startVirtualThread(() -> { ... });
// 或
Executors.newVirtualThreadPerTaskExecutor();
```

**P7 面试**：VThread 不等于"所有场景都用"。CPU 密集场景仍需平台线程池控制并发；IO 密集场景（微服务大量 RPC 调用）切换到 VThread 可大幅降低内存和上下文切换开销。

---

### Q11（补全）：Stream 流的惰性求值与并行流陷阱
**A：**

**惰性求值**：`filter/map` 等中间操作不立即执行，只在终端操作（`collect/forEach/reduce`）触发时才计算。好处：短路优化（`findFirst` 找到即停）。

**并行流陷阱**：

```java
// ❌ 错误: 并行流中使用非线程安全的 ArrayList
List<Integer> list = new ArrayList<>();
IntStream.range(0, 1000).parallel().forEach(list::add); // 数据丢失!

// ✅ 正确: 用 collect 或线程安全集合
List<Integer> list = IntStream.range(0, 1000).parallel().boxed().collect(Collectors.toList());
```

**ForkJoinPool 共通**：并行流默认使用 `ForkJoinPool.commonPool()`（CPU核数-1个线程）。IO 密集型任务需自定义线程池：

```java
ForkJoinPool customPool = new ForkJoinPool(20);
customPool.submit(() -> list.parallelStream().forEach(...));
```

**核心原则**：数据量大+独立计算→并行流；有状态/有锁/IO操作→不用并行流。

---

### Q12（补全）：常用设计模式在 Spring 中的体现
**A：**

| 模式 | Spring 中的体现 | 一句话 |
| --- | --- | --- |
| **单例** | `@Bean` 默认 Scope=singleton | Bean 容器管理的默认模式 |
| **工厂** | `BeanFactory` / `FactoryBean` | 延迟实例化+灵活创建 |
| **策略** | `Resource` 接口 → `ClassPathResource`/`FileSystemResource`/`UrlResource` | 同一接口不同实现 |
| **观察者** | `ApplicationEvent` + `@EventListener` | 解耦事件发布与处理 |
| **模板方法** | `JdbcTemplate` / `RestTemplate` / `TransactionTemplate` | 定义骨架，子类填充细节 |
| **代理** | AOP（`JdkDynamicAopProxy` / `CglibAopProxy`） | 核心中的核心 |
| **责任链** | Filter Chain / Interceptor Chain | 请求层层传递 |


> P7 面试：不说"我学过设计模式"，而是"Spring 的 Xxx 用到了 Y 模式，解决了 Z 问题"。
>

---

### Q13（新增 — Java 基础高频八股）：Java 是值传递还是引用传递？BigDecimal 为什么替代 double？装箱拆箱与 Integer 缓存池？equals 与 hashCode 的契约？
**A：**

**1. Java 只有值传递**：方法参数传递的是**值的副本**——基本类型传数值副本，引用类型传**引用（地址）的副本**。所以方法内修改引用指向的对象内容会生效（两个引用指向同一对象），但修改引用本身（重新 new/赋值）不影响外部变量。"引用传递"在 Java 中不存在。

**2. 八种基本类型**：byte(1B)、short(2B)、int(4B)、long(8B)、float(4B)、double(8B)、char(2B)、boolean(1bit 实际 1B)。int 是 32 位，long 是 64 位。默认整数字面量是 int，浮点是 double。

**3. BigDecimal 为什么替代 double**：double 是二进制浮点运算，0.1 这类小数无法精确表示（如 0.1+0.2=0.30000000000000004）——**金融计算必须用 BigDecimal(String)**，`new BigDecimal("0.1")` 而不是 `new BigDecimal(0.1)`（后者仍带误差）。运算用 add/subtract/multiply/divide(指定舍入模式)，比较用 compareTo 而非 equals。

**4. 装箱拆箱与 Integer 缓存池**：装箱 = int→Integer（valueOf），拆箱 = Integer→int（intValue）。`Integer.valueOf()` 默认缓存 **-128 ~ 127**（上限可调 -XX:AutoBoxCacheMax）——所以 `Integer a=127, b=127; a==b` 为 true（同一缓存对象），`128==128` 为 false（两个新对象）。面试陷阱：== 比较的是引用地址，比较值用 equals；混合运算时自动拆箱。

**5. String / StringBuffer / StringBuilder**：String 不可变（final char[]/byte[]，常量池），每次拼接产生新对象；StringBuffer 线程安全（synchronized）；StringBuilder 非线程安全但快。循环内拼接用 StringBuilder（编译器对字面量 + 有优化，但循环内仍创建新对象）。JDK9 后底层 byte[]+coder 按 Latin-1/UTF-16 存。

**6. equals 与 hashCode 契约**：equals 相等 → hashCode 必须相等；hashCode 相等 → equals 不一定相等。重写 equals 必须重写 hashCode，否则 HashMap/HashSet 行为错误（逻辑相等的对象落入不同桶）。

**高频追问**：

| 问题 | 答案 |
| --- | --- |
| 重载与重写区别？ | 重载：同类同名不同参，编译期静态分派；重写：子类覆盖父类，运行期动态分派（多态） |
| 抽象类与接口区别？ | 抽象类单继承、可有构造器/字段/非抽象方法，表达"is-a"；接口多实现、默认方法(8+)、表达"can-do"；抽象类不能 final、不能实例化 |
| try{return "a"} finally{return "b"} 返回什么？ | "b"——finally 的 return 覆盖 try 的 return；开发规约禁止 finally 中 return |
| Integer 相比 int 为什么还要保留 int？ | int 直接存值零开销；Integer 有对象头/引用开销，且可能 NPE——性能敏感场景用 int |


---

### Q14（新增 — 序列化）：Java 序列化机制是什么？如何自己实现一个序列化协议？跨 JVM 传输对象怎么设计？
**A：**

**1. Java 原生序列化机制**：对象实现 `Serializable` 接口（标记接口），`ObjectOutputStream` 将对象图（含对象引用关系、循环引用）编码为二进制流，反序列化时重建对象（**不调用构造器**，走最父类非序列化类的构造器）。serialVersionUID 校验版本兼容。

**2. 原生序列化的三大缺陷**：

+ **安全漏洞**：反序列化可触发任意代码执行（反序列化攻击，历史上大量 RCE 漏洞）
+ **不跨语言**：只有 JVM 能解析
+ **性能差**：体积大（类描述信息冗余）、速度慢
+ 生产实践：跨服务调用禁用 Java 原生序列化，改用 JSON/Protobuf/Kryo/Hessian。

**3. 自己实现一个序列化协议（P7 必答）**：

```plain
① 魔数（magic，2~4 字节）：校验协议类型，如 0xCAFEBABE
② 版本号：协议升级兼容（新版本解析旧数据）
③ 长度字段：总长度/分块长度，解决 TCP 粘包拆包
④ 数据体：按类型编码——整数变长编码（Varint）、字符串=长度+UTF-8 字节、对象=字段顺序编码
⑤ 校验：CRC/校验和，传输损坏可检测
```

+ **要点**：小端/大端统一、null 表示（0 长度）、集合=元素个数+元素列表、兼容性策略（新增字段默认值/字段号跳读——参考 Protobuf 的 field number 设计）。

**4. 主流序列化框架选型**：

| 框架 | 格式 | 性能 | 跨语言 | 适用 |
| --- | --- | --- | --- | --- |
| JSON (Jackson/Gson) | 文本 | 中 | ✅ | 通用 API、可读性好 |
| Protobuf | 二进制 | 🏆 高 | ✅ | RPC、高性能传输 |
| Kryo | 二进制 | 高 | ❌ | JVM 内部（Spark/Flink 用） |
| Hessian | 二进制 | 中 | ✅ | 跨语言 RPC（Dubbo 默认） |
| Java 原生 | 二进制 | 低 | ❌ | 仅 JVM 内部兼容场景 |


**5. 跨 JVM 传输对象的完整链路**：对象 → 序列化（编码）→ 网络传输（协议 + 粘包处理）→ 反序列化（解码）→ 对象。关键：两端协议版本一致、类定义一致（或 schema 兼容）、字符编码统一（UTF-8）。

**高频追问**：

| 问题 | 答案 |
| --- | --- |
| 反序列化为什么不调构造器？ | 通过 Unsafe.allocateInstance 直接分配内存不初始化，绕过构造逻辑（也是序列化攻击的温床） |
| transient 关键字？ | 标记字段不参与序列化；静态字段本来就不序列化（属于类） |
| 序列化框架如何保证兼容？ | 字段号/名称绑定 + 默认值策略：新增字段旧端忽略，删除字段新端给默认值——Protobuf 是标杆 |
| 为什么 Redis/缓存序列化选 Kryo 不选 JSON？ | 二进制体积小（网络/内存省）、速度快，缓存场景同语言无需可读性 |


---

### Q15（新增 — HashMap 高频追问）：HashMap 容量为什么是 2 的 n 次方？为什么红黑树而不是 AVL 树？哈希冲突怎么解决？HashMap 与 Hashtable、ConcurrentHashMap 有何区别？
**A：**

**1. 容量为什么是 2 的 n 次方**：为了用 `hash & (n-1)` 位运算代替 `hash % n` 取模（位运算远快于取模）；同时扩容时高低位拆分只需判断 `hash & oldCap` 一位。1.8 构造器即使传入非 2 次方值，也会被 `tableSizeFor` 向上取整为 2 的次方。

**2. 为什么红黑树而不用 AVL（平衡二叉树）**：AVL 严格平衡（任意节点左右子树高度差 ≤1），**插入删除需要大量旋转**；红黑树是非严格平衡（最长路径 ≤ 2 倍最短路径），**插入删除最多 2~3 次旋转**，增删性能更稳定。HashMap 是频繁插入删除的场景，查询 O(logN) 两者同阶——红黑树是增删查的综合最优。

**3. 哈希冲突解决方法**：

| 方法 | 原理 | 代表 |
| --- | --- | --- |
| 链地址法 | 冲突元素挂链表（1.8 转红黑树） | HashMap |
| 开放定址法 | 冲突后线性/二次探测下一个空槽 | ThreadLocalMap |
| 再哈希法 | 冲突后用第二个哈希函数重新计算 | Redis dict（渐进式 rehash） |
| 公共溢出区 | 冲突元素统一放溢出表 | 少见 |


**4. get 过程**：`hash(key)`（扰动）→ `(n-1) & hash` 定位桶 → 桶头比较（hash 相同再 equals）→ 链表遍历 / 红黑树查找 → 返回或 null。key 为 null 时直接定位第 0 桶（1.8 的 hash 方法对 null 返回 0）；**ConcurrentHashMap 不允许 null key/value**（无法区分"没找到"和"值为 null"）。

**5. String 为什么适合做 key**：① 不可变——hashCode 不会中途变化（可变对象做 key，内容变了会定位不到原桶）② hashCode 计算后被缓存，重复计算零开销 ③ equals 高效。自定义对象做 key：重写 equals 必须同步重写 hashCode，且字段要参与一致性计算。

**6. 存 20 个元素扩容几次**：初始容量 16、负载因子 0.75 → 阈值 12。插到第 13 个时扩容 16→32（阈值 24），20 个元素只触发 **1 次扩容**（数组扩容发生在 add 后 size > threshold 时）。

**7. HashMap vs Hashtable vs ConcurrentHashMap**

| 维度 | HashMap | Hashtable | ConcurrentHashMap |
| --- | --- | --- | --- |
| 线程安全 | ❌ | ✅ 全方法 synchronized | ✅ 桶级锁/CAS |
| null key/value | ✅ 允许 | ❌ | ❌ |
| 性能 | 高 | 低（全局锁） | 🏆 高 |
| 结构 | 数组+链表/红黑树 | 数组+链表（无树化） | 数组+链表/红黑树 |
| 用途 | 单线程 | 已淘汰 | 并发场景 |


---

### Q16（新增 — 集合高频补充）：ArrayList 线程不安全的具体表现？线程安全的 List/Set/Map 有哪些？LinkedHashMap 与 TreeSet 有什么用？
**A：**

**1. ArrayList 线程不安全的具体表现**：

+ **数据覆盖**：两个线程同时 add，elementData[size++] 不是原子操作——读到同一个 size，后写覆盖先写，元素丢失。
+ **数组越界**：扩容检查与写入非原子，两线程同时通过边界检查后扩容，一个写入时另一个已写满 → ArrayIndexOutOfBoundsException。
+ **读到 null**：size 先自增、元素后赋值之间，其他线程读到 size 内的 null。
+ 解决：① Collections.synchronizedList（全局锁，迭代仍需手动同步）② **CopyOnWriteArrayList**（写时复制，读无锁，适合读多写极少）③ 写多场景用并发队列替代。

**2. 线程安全集合速查**：

| 类型 | 线程安全实现 |
| --- | --- |
| Map | ConcurrentHashMap（首选）、Hashtable（淘汰）、Collections.synchronizedMap |
| List | CopyOnWriteArrayList、Collections.synchronizedList、Vector（淘汰） |
| Set | CopyOnWriteArraySet、ConcurrentHashMap.newKeySet()、Collections.synchronizedSet |
| Queue | ConcurrentLinkedQueue、ArrayBlockingQueue/LinkedBlockingQueue |


**3. List/Set/Map 体系**：Collection 接口下分 List（有序可重复：ArrayList 随机访问快 / LinkedList 增删快）、Set（不可重复：HashSet / TreeSet 排序 / LinkedHashSet 保插入序）、Queue；Map 独立体系（HashMap / TreeMap 键排序 / LinkedHashMap 保插入序 / CHM）。

**4. LinkedHashMap 与 TreeSet/TreeMap**：

+ **LinkedHashMap**：双向链表记录插入顺序（accessOrder=true 变 LRU 序）——LRU 缓存就是用 LinkedHashMap 重写 removeEldestEntry 实现。
+ **TreeSet/TreeMap**：红黑树实现，key 按自然序或 Comparator 排序；Set 排序也可以 new TreeSet(hashSet) 转换。

**5. List 与数组互转**：`list.toArray(new String[0])`（推荐，JVM 优化后零拷贝）；`Arrays.asList(arr)` 返回的是**固定大小视图**（不支持 add/remove，且基本类型数组会被当成单个元素——int[] 转出来是装着一个数组元素的 List，而不是每个元素一个 Integer）。

**高频追问**：

| 问题 | 答案 |
| --- | --- |
| 集合遍历方式？ | for-each（迭代器）、Iterator.remove、Stream、forEach；遍历时增删需用 Iterator.remove 否则 ConcurrentModificationException |
| LinkedList 的应用场景？ | 频繁头尾增删（LRU 队列、栈）；随机访问少 |
| 分段锁可重入吗？ | 1.7 CHM 的 Segment 继承 ReentrantLock——可重入 |
| 已经用了 synchronized 为什么还用 CAS？ | CAS 无锁竞争时开销极小（空桶插入）；synchronized 管复杂结构（链表/树插入）——按桶状态分场景取舍 |


---

## 🎯 P7 面试之 STAR 映射
| 知识点 | 一句话 |
| --- | --- |
| HashMap | "CI 构建偶发死循环，定位到 JDK7 HashMap 并发扩容环形链表，升级到 ConcurrentHashMap" |
| Lambda | "订单查询用 Lambda Stream 并行流，8000 条数据 from CSV 导入耗时从 2s 降到 300ms" |
| Netty | "网关从 Tomcat BIO 迁移到 Netty NIO，单机并发连接从 2000 提升到 50000" |
| 泛型 | "封装通用 Response 包装类，利用泛型实现类型安全的 API 返回体，杜绝 ClassCastException" |
| finally | "在线充值逻辑 finally 中写 return 导致 try 中 return 被覆盖，充值丢失——已纳入团队代码规约" |
| Java 基础 | "压测发现订单金额用 double 计算出现分差，全部改为 BigDecimal(String) 后对账零差异" |
| 序列化 | "RPC 框架从 Java 原生序列化切换到 Protobuf，报文体积降 60%，跨语言网关直接解析" |
| VThread | "压测对比 VThread vs 线程池：1000 并发 RPC 调用场景下内存峰值从 2GB 降到 500MB" |
| HashMap 追问 | "缓存热点对象用自定义 key 忘记重写 hashCode，定位到 1.7 扩容后桶漂移，统一改用 String 做 key 后解决" |
| 线程安全集合 | "秒杀名单用 CopyOnWriteArrayList 存储配置，读多写少场景 QPS 比同步容器提升 5 倍" |


---

## 📚 扩展阅读
+ 《Effective Java》第3版 — Item 31 (PECS)
+ 《深入理解 Java 虚拟机》第3版 — 第8章（字节码执行引擎）
+ Netty In Action — 第7章 Reactor 线程模型
+ JEP 444 — Virtual Threads
+ OpenJDK 源码 — HashMap / ConcurrentHashMap
+ 小林coding — Java 面试题（基础/面向对象/泛型/反射/异常/序列化/IO）
+ 小林coding — Java 集合面试题（List/Set/Map/线程安全集合）

