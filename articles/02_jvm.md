# 二、JVM 与性能调优（P7常深挖）
> **目标岗位：阿里 P7 后端开发**  
P7 核心能力要求：能从内存结构 + GC 算法 + 类加载 + JIT 编译四层视角诊断 JVM 问题、能独立完成 OOM/CPU 飙高/Full GC 频繁的排查与调优、能从原理层面解释 GC 选型理由。
>

---

## 📋 知识体系总览
```plain
JVM 与性能调优
├── 内存结构
│   ├── 运行时数据区（堆/栈/元空间/直接内存/程序计数器）
│   ├── 对象分配流程（逃逸分析→TLAB→Eden→老年代）
│   └── 栈上分配、标量替换、锁消除
├── 类加载
│   ├── 加载→验证→准备→解析→初始化 五步
│   ├── 双亲委派模型（Bootstrap→Ext→App→Custom）
│   ├── 打破双亲委派（SPI/Tomcat/自定义 ClassLoader）
│   └── Class.forName vs loadClass
├── 垃圾收集器
│   ├── 分代理论（弱分代假说、强分代假说、跨代引用假说）
│   ├── CMS（四步流程、三色标记+增量更新、CMF 根因）
│   ├── G1（Region/SATB/RSet/混合回收、Mixed GC）
│   └── ZGC（染色指针、并发标记-整理、<1ms STW）
├── JIT 编译优化
│   ├── 逃逸分析→标量替换→锁消除→锁粗化
│   ├── 方法内联、循环展开、分支预测
│   └── C1/C2 编译器分层编译
├── 性能排障
│   ├── OOM 排查（堆/元空间/直接内存/GCLimit 四种）
│   ├── Full GC 频繁排查（CMS/G1 参数调优）
│   ├── CPU 飙高排查（top+jstack+arthas）
│   └── 内存泄漏（ThreadLocal/静态集合/连接池）
└── 面试融合
    └── STAR 映射表
```

**P6 vs P7 回答层次：**

| 维度 | P6 回答 | P7 回答 |
| --- | --- | --- |
| 内存模型 | 说出堆/栈/方法区 | 画出对象分配全流程、解释 TLAB 的 CAS 优化、分析逃逸分析如何影响分配 |
| 类加载 | 说出双亲委派流程 | 解释 SPI 反向加载原理、分析 Tomcat 类隔离的 loadClass 重写、能设计自定义 ClassLoader |
| GC | 说出 CMS/G1 流程 | 能解释三色标记算法、SATB vs 增量更新区别、分析 CMF 根因并给出参数调优公式 |
| 排障 | 用 jmap+jstack 看 | 能从 GC 日志分析晋升阈值、用 MAT 定位 GC Root 引用链、给出根治方案而非重启 |


---

## 参考资源
+ [美团技术 — JDK17 ZGC 实践](https://tech.meituan.com/2025/06/20/JDK17-ZGC.html)
+ 《深入理解 Java 虚拟机》第3版 周志明
+ 《垃圾回收算法手册》 — Richard Jones
+ Oracle 官方文档 — G1 GC Tuning
+ Plumbr — Java Garbage Collection Handbook

---

### Q1：JVM 运行时数据区包含哪些？对象创建时的内存分配过程是怎样的？
**A：**

**1. 运行时数据区全景**

```plain
┌──────────────────────────────────────────────────────┐
│                    线程共享                           │
│  ┌────────────┐  ┌──────────────────────────────────┐│
│  │    堆      │  │         元空间 (Metaspace)        ││
│  │  (Heap)    │  │  类元数据 / 方法信息 / 常量池      ││
│  │  对象实例   │  │  (本地内存，非堆!)                 ││
│  └────────────┘  └──────────────────────────────────┘│
│  ┌──────────────────────────────────────┐            │
│  │       直接内存 (Direct Memory)        │            │
│  │  NIO ByteBuffer / Unsafe.allocate    │            │
│  └──────────────────────────────────────┘            │
├──────────────────────────────────────────────────────┤
│                    线程私有                           │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐      │
│  │程序计数器│  │ Java虚拟机栈│  │ 本地方法栈    │      │
│  │   PC     │  │ 栈帧(局部  │  │ Native Method│      │
│  │          │  │ 变量表等)  │  │              │      │
│  └──────────┘  └───────────┘  └──────────────┘      │
└──────────────────────────────────────────────────────┘
```

**2. 对象分配全流程（P7 必须能画出来）**

```plain
new Object()
  │
  ├─ ① 逃逸分析（Escape Analysis）
  │     └─ 对象不逃逸出方法/线程？
  │        ├─ YES → 标量替换（Scalar Replacement）+ 锁消除
  │        │        将对象成员变量拆为独立局部变量 → 栈上分配，无 GC！
  │        └─ NO  → 进入堆分配
  │
  ├─ ② TLAB（Thread Local Allocation Buffer）
  │     └─ 每个线程在 Eden 区独占一小块（默认 1% Eden）
  │     └─ 指针碰撞（bump-the-pointer）分配，无锁！
  │     └─ TLAB 空间不足 → 判断是否可申请新 TLAB
  │        ├─ YES → 申请新 TLAB，继续分配
  │        └─ NO  → CAS 竞争共享 Eden 区
  │
  ├─ ③ Eden 区分配
  │     └─ 通过 CAS + 指针碰撞在 Eden 区分配
  │     └─ Eden 满 → 触发 Minor GC（Young GC）
  │
  └─ ④ 大对象直接进老年代
        └─ 对象大小 > -XX:PretenureSizeThreshold（默认 0=关闭）
        └─ 避免大对象在 Survivor 区反复拷贝
```

**TLAB 设计智慧**：线程本地分配缓冲消除竞争——每个线程在自己的 TLAB 内使用指针碰撞，无需 CAS / 加锁。这是 JVM 在高并发下"lock-free"分配的核心技术。

**3. 栈上分配 vs 实际内存位置**

HotSpot 并没有真正在栈上分配对象。**标量替换**才是本质：JIT 编译器将对象的成员变量"拆解"为独立的局部变量，分配到栈帧的局部变量表，对象整体不存在了——所以 GC 完全感知不到它。

---

### Q2：类加载全过程？双亲委派模型如何工作？如何打破？
**A：**

**1. 类加载五阶段**

```plain
加载→验证→准备→解析→初始化
  │     │     │     │      │
 获取   校验   static  符号引用→  <clinit>
.class  字节码  赋零值  直接引用  static块
```

**2. 双亲委派模型**

```plain
Bootstrap ClassLoader        ← 加载 rt.jar (java.lang.*)
       ↑ 委派
Extension/Platform ClassLoader ← 加载 jre/lib/ext
       ↑ 委派
Application ClassLoader      ← 加载 -classpath 中的类
       ↑ 委派
Custom ClassLoader           ← 用户自定义
```

**工作流程**：收到请求 → 先查缓存 → 未加载则委派父加载器 → 直到 Bootstrap → 父找不到了自己才 `findClass()`。

**3. 打破双亲委派三种经典场景**

| 场景 | 实现 | 代表 |
| --- | --- | --- |
| **SPI 机制** | 核心类（DriverManager）需调用实现类，但核心类由 Bootstrap 加载，实现类由 App 加载 → 委派无法逆向！→ 使用 **TCCL** | JDBC 驱动加载 |
| **Web 容器隔离** | WebappClassLoader 重写 loadClass()，优先自己加载，打破委派 | Tomcat |
| **热部署** | 卸载 ClassLoader → 重新加载 → 新的 Class 对象 | OSGi、Arthas |


**4. Class.forName vs loadClass**

| 方法 | 初始化 | 适用 |
| --- | --- | --- |
| `Class.forName("name")` | ✅ 执行 `<clinit>`（静态代码块） | JDBC 驱动注册 |
| `ClassLoader.loadClass("name")` | ❌ 不初始化，延迟到首次使用 | Spring 扫描 Bean 定义 |


---

### Q3：CMS 垃圾收集器的运行流程是什么？为什么发生 Concurrent Mode Failure？如何调优？
**A：**

**1. CMS 四步流程 + 三色标记算法**

```plain
① 初始标记（STW, ~1ms）
   └─ 标记 GC Roots 直接可达的对象 → 标记为"灰色"

② 并发标记（与用户线程并发, ~80% 时间）
   └─ 三色标记:
       白色: 未访问（潜在垃圾）
       灰色: 已访问但子节点未遍历完
       黑色: 已访问且子节点全部遍历完
   └─ 并发期间用户线程修改引用 → 已标记的黑色对象引用新创建的白对象 → 白对象不会被标记 → 漏标！

③ 重新标记（STW, ~几十ms）
   └─ 采用"增量更新"算法：黑色对象新增对白色对象引用时，记录该黑色对象 → 重新扫描

④ 并发清除（与用户线程并发）
   └─ 清理白色对象 → 加入空闲列表（free list）→ 不移动对象 → 产生内存碎片
```

**2. Concurrent Mode Failure（CMF）— P7 核心**

```plain
根因: 并发清除期间，老年代剩余空间不足以容纳晋升对象
  ↓
JVM 退化为 Serial Old 单线程回收（STW 几百ms~几s!）
  ↓
GC 日志出现 "concurrent mode failure" → pause time 暴增

触发条件:
  ① 浮动垃圾太多（并发清除期间新产生的垃圾）
  ② 对象晋升速度 > 清除速度
  ③ 碎片化严重（free list 没有连续空间）
```

**3. CMS 调优参数**

```plain
-XX:CMSInitiatingOccupancyFraction=75  ← 老年代达75%启动CMS
  调低(65): 提前启动 → 降低 CMF 风险，但增加 GC 频率
  调高(85): 减少 GC 频率，但增加 CMF 风险

-XX:+CMSScavengeBeforeRemark  ← 重新标记前先做一次 Young GC
-XX:+CMSClassUnloadingEnabled ← CMS 也回收元空间
```

**4. CMS 已废弃（JDK9 deprecated → JDK14 移除）**

P7 面试会被问"你们为什么还在用 CMS？迁移到 G1/ZGC 的收益和风险？"

---

### Q4：G1 收集器的内存布局和回收过程是怎样的？RSet 和 SATB 如何工作？
**A：**

**1. G1 内存布局 — Region 化**

```plain
┌───┬───┬───┬───┬───┬───┬───┬───┐
│ E │ E │ S │ O │ H │ E │ O │ F │   每个 Region = 1~32MB
└───┴───┴───┴───┴───┴───┴───┴───┘
  E=Eden  S=Survivor  O=Old  H=Humongous(大对象)  F=Free
```

**2. G1 回收三阶段**

```plain
① Young GC（STW）— 只回收 Eden+Survivor，RSet 避免全堆扫描

② Mixed GC（STW+部分并发）— 回收收益最高的若干 Old Region
   触发: -XX:InitiatingHeapOccupancyPercent(默认45%)
   步骤: 初始标记(Young GC顺带做) → 并发标记 → 重新标记(STW) → 拷贝回收(STW)

③ Full GC（STW，尽量避免!）— Mixed GC 来不及 → 并行版标记-整理
```

**3. RSet — 解决跨 Region 引用**

```plain
问题: Young GC 只回收 Eden，Old Region 可能引用 Eden 中的对象
方案: 每个 Region 维护 RSet: "谁引用了我？"
      Young GC 时只扫描 RSet 指向的区域 → 无需全堆扫描
      代价: 写屏障维护 RSet → ~5% 吞吐量开销
```

**4. SATB vs 增量更新 — P7 必问**

| 算法 | 收集器 | 机制 | 漏标处理 |
| --- | --- | --- | --- |
| **增量更新** | CMS | 黑色对象新增对白对象引用时，记录该黑色对象 → 重新扫描 | 记录"新增引用" |
| **SATB** | G1 | 并发标记开始时拍快照，若引用被删除，通过"写前屏障"记录到 SATB 队列 | 记录"被删除的引用" |


SATB 的副作用：删除的引用成为"浮动垃圾"，等下一轮回收。

---

### Q5：生产环境频繁 Full GC，你如何排查和解决？
**A：**

**1. 先看 GC 日志 — 定位 FGC 类型**

```plain
[Full GC (Allocation Failure)]      → 堆内存不足 → 增大 -Xmx 或排查泄漏
[Full GC (Ergonomics)]              → G1 Mixed GC 来不及 → 调大 IHOP
[Full GC (Metadata GC Threshold)]   → 元空间不足 → 调大 MaxMetaspaceSize
[Full GC (System.gc())]             → 代码显式调用 → -XX:+DisableExplicitGC
```

**2. 常见根因与对策**

| 根因 | 对策 |
| --- | --- |
| 堆太小 | 调大 `-Xmx` + `-Xmn` |
| 内存泄漏 | MAT 分析 GC Root 引用链 → 修复泄漏 |
| 大对象直接进老年代 | 检查超大对象 / 调大 Region 大小 |
| 元空间不足 | 调大 `-XX:MaxMetaspaceSize` + 排查类加载器泄漏 |
| CMS CMF | 调低 `CMSInitiatingOccupancyFraction` |
| 晋升阈值过低 | 调大 `MaxTenuringThreshold` 到 6~15 |


**3. 常用命令速查**

```bash
jstat -gcutil <pid> 1000          # GC 统计实时观察
jmap -histo:live <pid> | head -30 # 存活对象 Top30
jmap -dump:live,format=b,file=heap.bin <pid>  # Dump
jstack <pid> > thread.dump        # 线程快照

# Arthas 神器
dashboard                          # JVM 实时大盘
thread -b                          # 死锁检测
heapdump /tmp/heap.hprof           # 在线 dump
vmtool --action getInstances --className com.xxx.MyClass --limit 100
```

---

### Q6：元空间溢出可能由哪些原因导致？如何排查？
**A：**

**元空间溢出四大根因**

| 根因 | 场景 | 排查 |
| --- | --- | --- |
| **动态代理类爆炸** | CGLIB 每次创建新代理类 | MAT 查 GeneratedMethodAccessor 数量 |
| **Groovy/JS 脚本引擎** | 每次 evaluate() 创建新类 | 查看 Script 类实例数 |
| **类加载器泄漏** | Tomcat 反复热部署 | 查看 ClassLoader 实例数 + GC Root |
| **Lambda 表达式** | 大量 invokedynamic 匿名类 | `jcmd <pid> VM.classloader_stats` |


```bash
jstat -gc <pid> | awk '{print "MU:"$8" MC:"$9}'  # 元空间使用量
jcmd <pid> VM.classloader_stats                   # 类加载器统计
```

---

### Q7：如何排查 OOM？堆 OOM 与直接内存 OOM 有何不同？
**A：**

**四种 OOM 类型**

| OOM 类型 | 错误信息 | 对策 |
| --- | --- | --- |
| **堆 OOM** | `Java heap space` | 增大堆 / 排查泄漏 |
| **GC Limit** | `GC overhead limit exceeded` | GC 时间>98%且回收<2% → 泄漏 |
| **元空间** | `Metaspace` | 增大 MaxMetaspaceSize / 排查类泄漏 |
| **直接内存** | `Direct buffer memory` | 增大 `-XX:MaxDirectMemorySize` |


**直接内存 OOM 特征**：堆 Dump 不大 但 RSS 远超 -Xmx、GC 日志正常、pmap 可见大量 64MB 匿名映射。

```bash
jcmd <pid> VM.native_memory summary  # 需开启 -XX:NativeMemoryTracking=detail
```

**自动 Dump 配置**：

```plain
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dump/heap_%p.hprof
```

---

### Q8：JIT 编译优化有哪些？逃逸分析、标量替换、锁消除如何工作？
**A：**

```plain
解释执行 → 热点探测(计数器)
  │
  ▼ C1编译(Client Compiler) → 快速编译
  │
  ▼ C2编译(Server Compiler) → 深度优化
```

**核心优化技术**

| 优化 | 原理 | 效果 |
| --- | --- | --- |
| **逃逸分析** | 分析对象作用域，是否逃逸方法/线程外 | 为标量替换+锁消除提供基础 |
| **标量替换** | 不逃逸对象 → 拆解为成员变量 → 栈上分配 | 完全消除堆分配+GC |
| **锁消除** | 对象不逃逸 → 移除 synchronized | 消除不必要的同步开销 |
| **锁粗化** | 连续加锁/解锁合并为一次 | 减少加锁次数 |
| **方法内联** | 小方法体嵌入调用方 | 消除调用开销+为其他优化铺路 |


**分层编译 Level 0~4**：0=解释→1=C1快速→2=C1带profiling→3=C1完整profiling→4=C2深度优化。

---

### Q9：频繁 Young GC 但对象未正常晋升老年代，是什么原因？
**A：**

```plain
根因: Survivor 区太小 → 对象放不下 → 提前晋升老年代
调优:
  -XX:SurvivorRatio=6          ← 增大 Survivor 占比
  -XX:MaxTenuringThreshold=15  ← 调大晋升年龄
  -XX:TargetSurvivorRatio=50   ← Survivor 期望使用率

GC 日志分析:
  Desired survivor size 524288 bytes, new threshold 6 (max 15)
  - age  2:   3097152 total  ← 超过 TargetSurvivorRatio → threshold 降到 6
```

---

### Q10：ThreadLocal 造成的内存泄漏如何排查和解决？
**A：**

> 📍 与「三、并发编程与锁机制」Q6 互补。本篇侧重 JVM 层面的泄漏排查。
>

**MAT 排查四步**：

```plain
① Histogram → 搜索 "ThreadLocal" → 实例数远超代码定义数？
② Dominator Tree → 按线程分组 → 查看 Retained Heap → 展开引用链
③ OQL: SELECT * FROM ThreadLocal$ThreadLocalMap$Entry WHERE referent = null
④ 通过 value 类型推断泄漏的业务模块 → 定位 ThreadLocal 变量
```

---

### Q11（新增 — ZGC）：ZGC 的核心原理是什么？为什么能 <1ms STW？
**A：**

**三大核心技术**

```plain
① 染色指针: 64位指针的42-45位标记GC状态，状态在指针中 → 零开销
② 读屏障: 读引用时自动修正(Remap)或标记(Mark)
③ 并发整理: 通过染色指针+读屏障，实现并发移动-整理 → 无碎片
```

**回收阶段**：标记(STW init→并发mark)→重定位(并发move)→再映射(读屏障自愈)。**仅初始/最终标记是STW → <1ms，与堆大小无关！**

**ZGC vs G1 vs Shenandoah**

| 维度 | G1 | ZGC |
| --- | --- | --- |
| 并发整理 | ❌(STW) | ✅ |
| STW 时间 | 随堆增大 | <1ms (不随堆!) |
| 适用堆 | 4GB~64GB | 8GB~16TB |
| 吞吐量 vs G1 | — | 略低 5~10% |


**P7 选型**：堆 < 32GB → G1；堆 > 32GB 或极致低延迟 → ZGC；JDK17+ → ZGC 是未来。

---

### Q12（新增 — 参数速查）：P7 必须掌握的 JVM 调优参数
**A：**

**基础参数**：`-Xms4g -Xmx4g`（避免动态扩容）、`-Xmn2g`、`-XX:MaxMetaspaceSize=512m`、`-XX:MaxDirectMemorySize=512m`

**GC 选择**：`-XX:+UseG1GC`(JDK9+默认) / `-XX:+UseZGC`(JDK15+)

**G1 调优**：`-XX:MaxGCPauseMillis=200`、`-XX:InitiatingHeapOccupancyPercent=45`、`-XX:G1HeapRegionSize=8m`

**诊断**：

```plain
# JDK9+: -Xlog:gc*:file=/path/gc.log:time,uptime:filecount=5,filesize=50M
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/
-XX:NativeMemoryTracking=detail
```

---

### Q13（新增 — JVM 基础高频八股）：堆和栈有什么区别？String 常量池在哪？四种引用是什么？为什么不用引用计数法判断垃圾？
**A：**

**1. 堆和栈的区别**

| 维度 | 栈（虚拟机栈） | 堆 |
| --- | --- | --- |
| 存储 | 局部变量表、操作数栈、方法调用帧 | 对象实例和数组 |
| 私有/共享 | 线程私有 | 线程共享（GC 主战场） |
| 生命周期 | 随方法调用进出栈帧 | 由 GC 管理 |
| 溢出 | StackOverflowError | OutOfMemoryError: Java heap space |


**栈里存的是指针还是对象？** 存的是**引用（指针）**——对象本体在堆；局部变量表里存基本类型值或对象引用。逃逸分析优化（标量替换）后，未逃逸对象可拆散在栈上分配，但那是 JIT 优化特例。

**2. String 常量池位置演进**：JDK6 及之前 → 永久代（PermGen，-XX:MaxPermSize 限制，易 OOM: PermGen space）；JDK7 → 移到**堆**；JDK8 → 堆（永久代改为元空间）。`new String("abc")` 执行：① 字符串字面量 "abc" 进入常量池（若不存在，创建一个）② new 在堆上创建 String 对象（**共 1 或 2 个对象**：常量池没有 "abc" 时是 2 个，已有时是 1 个）③ 局部变量表中存堆上对象的引用。

**3. 四种引用**

| 类型 | 回收时机 | 场景 |
| --- | --- | --- |
| 强引用 | 永不回收（除非无引用） | 默认 new |
| 软引用（SoftReference） | 内存不足时回收 | 缓存（内存敏感） |
| 弱引用（WeakReference） | 下次 GC 必回收 | ThreadLocal key、WeakHashMap |
| 虚引用（PhantomReference） | 无法获取对象，回收时入队列 | 直接内存回收跟踪（Cleaner） |


**4. 为什么不用引用计数法判断垃圾**：引用计数法简单但**无法解决循环引用**——A 引用 B、B 引用 A，计数永不为 0 → 泄漏。JVM 用**可达性分析**：从 GC Roots（栈引用、静态变量、JNI 引用、常量）出发遍历引用链，不可达的即为垃圾。

**高频追问**：

| 问题 | 答案 |
| --- | --- |
| 大对象分配到哪？ | 直接进老年代（超过 -XX:PretenureSizeThreshold，避免在新生代反复复制） |
| GC 只回收堆吗？ | 不是——方法区（元空间）也会回收废弃常量和无用的类 |
| 程序计数器为什么线程私有？ | 记录当前线程执行到的字节码行号，线程切换后能恢复执行位置 |
| 方法区存什么？ | 类元信息、常量、静态变量、JIT 编译后的代码缓存 |


---

## 🎯 P7 面试之 STAR 映射
| 知识点 | 一句话 |
| --- | --- |
| 内存结构 | "RSS 持续增长但堆 Dump 不大，NMT 定位到 DirectByteBuffer 未释放" |
| 类加载 | "Tomcat 热部署后 Metaspace OOM，ClassLoader 未关闭导致类泄漏" |
| GC 调优 | "CMS 频繁 CMF，迁移到 G1+调整 IHOP=35% 后 FGC 降为 0" |
| OOM 排查 | "MAT Dominator Tree 定位 ThreadLocal 泄漏，修复后老年代降 2GB" |
| JIT | "冷启动 30min 达到峰值 QPS，分层编译+AppCDS 缩短到 5min" |
| ZGC | "支付服务 G1 STW 200ms 优化到 ZGC <0.5ms" |


---

## 📚 扩展阅读
+ [美团技术 — JDK17 ZGC 实践](https://tech.meituan.com/2025/06/20/JDK17-ZGC.html)
+ 《深入理解 Java 虚拟机》第3版 周志明
+ Oracle 官方文档 — G1 GC Tuning
+ Plumbr — Java Garbage Collection Handbook
+ Arthas 官方文档 — JVM 诊断命令
+ 小林coding — JVM 面试题（内存模型/类加载/垃圾回收）

