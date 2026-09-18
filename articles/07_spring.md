# 七、框架与微服务生态（Spring 全家桶）
> **目标岗位：阿里 P7 后端开发**  
P7 核心能力要求：能结合源码推导边界行为、能从架构层面做技术选型与权衡、能设计高可用的微服务治理体系、能指导团队避坑。
>

---

## 知识体系总览
```plain
框架与微服务生态（Spring 全家桶）
├── Spring 核心深度
│   ├── IOC 容器（启动流程、Bean 生命周期、三级缓存、扩展点）
│   ├── AOP 原理（JDK vs CGLIB、代理创建时机、拦截器链）
│   ├── 事务管理（传播行为、隔离级别、失效场景源码分析）
│   └── Spring Boot（自动配置、starter 设计、启动流程）
├── 服务治理
│   ├── 注册中心（Nacos CP/AP 双模式 vs Eureka AP）
│   ├── 配置中心（Nacos 动态刷新、灰度配置、@RefreshScope 原理）
│   ├── 负载均衡（Ribbon → Spring Cloud LoadBalancer 演进）
│   └── 远程调用（Feign / RestTemplate / WebClient 对比）
├── 网关与流量控制
│   ├── API 网关（Gateway WebFlux 原理、Zuul 对比、Kong/APISIX）
│   ├── 限流降级（Sentinel 滑动窗口、令牌桶、熔断策略）
│   ├── 灰度发布（金丝雀、蓝绿部署、全链路灰度）
│   └── 容错与隔离（信号量/线程池隔离、Resilience4j）
├── 分布式事务
│   └── Seata（AT / TCC / Saga / XA 模式原理与选型）
├── 可观测性（P7 必问）
│   ├── 指标监控（Micrometer + Prometheus + Grafana）
│   ├── 链路追踪（Micrometer Tracing / Sleuth + Zipkin）
│   └── 日志聚合（ELK / Loki）
└── 生产排障
    ├── CPU 飙高 / 内存泄漏 / OOM 排查方法论
    └── 微服务调用链超时分析与降级演练
```

**P6 vs P7 回答层次：**

| 维度 | P6 回答 | P7 回答 |
| --- | --- | --- |
| IOC/循环依赖 | 能说出三级缓存流程 | 能解释为什么构造器注入无法解决、AOP 代理提前暴露的处理、FactoryBean 机制 |
| AOP/事务 | 说出 JDK vs CGLIB 区别 | 能推导 `@Transactional` 失效的源码级原因、事务传播行为在嵌套调用中的行为 |
| 自动配置 | 说出 spring.factories 加载流程 | 能设计工业级 starter（条件装配、配置校验、依赖隔离、兼容性） |
| 服务治理 | 能对比 Nacos 和 Eureka | 能结合业务选 CP/AP、设计灰度配置发布流程 |
| 网关/限流 | 说出 Gateway 非阻塞、Sentinel 限流算法 | 能画过滤器链执行顺序、给出限流参数配置公式、设计全链路灰度方案 |
| 问题排查 | 根据日志找错误 | 有系统性的排障方法论（CPU→线程→GC→内存→网络逐层排查） |


---

## 参考资源
+ Spring 官方文档 & Spring Boot Reference Documentation
+ 《Spring 揭秘》王福强 — IOC/AOP 实现细节
+ 阿里巴巴 Sentinel Wiki & Nacos 官方文档
+ Spring Cloud Gateway 官方文档
+ Seata 官方文档（AT/TCC/Saga 模式详解）

---

### Q1：Spring IOC 容器启动流程是怎样的？Bean 的生命周期有哪些关键步骤？Spring 如何解决循环依赖？
**A：**

**1. IOC 容器启动流程（以 AnnotationConfigApplicationContext 为例）**

```plain
new AnnotationConfigApplicationContext(AppConfig.class)
  │
  ├─ 1. this() — 创建 AnnotatedBeanDefinitionReader + ClassPathBeanDefinitionScanner
  ├─ 2. register(AppConfig.class) — 将配置类注册为 BeanDefinition
  └─ 3. refresh() — 核心启动流程
       ├─ prepareRefresh()            — 准备 Environment、PropertySources
       ├─ obtainFreshBeanFactory()    — 创建 BeanFactory、扫描包路径、加载所有 BeanDefinition
       ├─ prepareBeanFactory()        — 设置 ClassLoader、SPEL 解析器、注册 ApplicationContextAwareProcessor
       ├─ postProcessBeanFactory()    — 子类扩展点（如 Web 容器注册 ServletContext）
       ├─ invokeBeanFactoryPostProcessors() — 执行 BeanFactoryPostProcessor
       │    └─ ConfigurationClassPostProcessor 解析 @Configuration、@ComponentScan、@Import
       ├─ registerBeanPostProcessors()— 注册 BeanPostProcessor（仅注册定义，尚未实例化）
       ├─ initMessageSource()         — 国际化 MessageSource
       ├─ initApplicationEventMulticaster() — 事件广播器
       ├─ onRefresh()                 — 子类扩展，Spring Boot 在此启动内嵌 Tomcat
       ├─ registerListeners()         — 注册 ApplicationListener
       ├─ finishBeanFactoryInitialization() — 实例化所有非懒加载单例 Bean
       │    └─ preInstantiateSingletons() → getBean() → createBean() → doCreateBean()
       └─ finishRefresh()             — 发布 ContextRefreshedEvent、启动 LifecycleProcessor
```

**2. Bean 生命周期（P7 必须能一步步讲出来）**

```plain
1. 实例化（Instantiation）
   └─ createBeanInstance() → 反射调用构造器（默认无参，或 @Autowired 标注的构造器）
2. 属性赋值（Populate）
   └─ populateBean() → AutowiredAnnotationBeanPostProcessor 处理 @Autowired、@Value
3. Aware 回调
   └─ BeanNameAware → BeanClassLoaderAware → BeanFactoryAware
       → EnvironmentAware → ApplicationContextAware → ...
4. BeanPostProcessor # postProcessBeforeInitialization()
   └─ ApplicationContextAwareProcessor 在此注入 ApplicationContext
5. 初始化（Initialization）
   └─ @PostConstruct → InitializingBean.afterPropertiesSet() → init-method
6. BeanPostProcessor # postProcessAfterInitialization()
   └─ AbstractAutoProxyCreator 在此创建 AOP 代理对象
7. 使用（Ready）
8. 销毁（Destruction）
   └─ @PreDestroy → DisposableBean.destroy() → destroy-method
```

**P7 扩展点区分**：

+ **BeanFactoryPostProcessor**：在 Bean 实例化**之前**修改 BeanDefinition（如 `${}` 占位符替换、修改 scope）。
+ **BeanPostProcessor**：在 Bean 实例化**之后**、初始化前后拦截处理（如 AOP 代理、@Autowired 注入）。

**3. 循环依赖与三级缓存**

Spring 仅能解决**单例 + setter/字段注入**的循环依赖，构造器注入无法解决（因为 Bean 创建的第一步就必须传入依赖的完整对象）。

**三级缓存数据结构：**

| 缓存 | 名称 | 存放内容 |
| --- | --- | --- |
| `singletonObjects`（一级） | 完全初始化好的单例 Bean | 可直接使用的成品 Bean |
| `earlySingletonObjects`（二级） | 提前曝光的早期引用 | 已创建但未填充属性的原始对象或 AOP 代理 |
| `singletonFactories`（三级） | 生成早期引用的工厂 | ObjectFactory 函数，可返回原始对象或提前生成 AOP 代理 |


**循环依赖解决流程（A ⇄ B）：**

```plain
1. getBean(A) → doCreateBean(A)
   └─ createBeanInstance(A)  — 反射创建 A 的原始实例
   └─ 将 A 的 ObjectFactory 放入三级缓存 ← 关键：此时 A 尚未填充属性
   └─ populateBean(A) → 发现依赖 B
        └─ getBean(B) → doCreateBean(B)
             └─ createBeanInstance(B)  — 创建 B 的原始实例
             └─ 将 B 的 ObjectFactory 放入三级缓存
             └─ populateBean(B) → 发现依赖 A
                  └─ getBean(A) → 在三级缓存中找到 A 的 ObjectFactory
                       └─ 调用 ObjectFactory.getObject() → 得到 A 的早期引用
                            └─ 如果 A 需要 AOP → 提前生成 A 的代理对象
                       └─ 将 A 的早期引用放入二级缓存，从三级缓存删除
                  └─ B 完成 populateBean(B) + initializeBean(B)
             └─ B 创建完成，放入一级缓存
        └─ A 拿到 B 的完整实例 → 完成 populateBean(A) + initializeBean(A)
   └─ A 创建完成，放入一级缓存
   └─ 最终：A 就是二级缓存中的早期引用（同一个对象），保障代理一致性
```

**为什么构造器注入无法解决？** 构造器注入在 `createBeanInstance` 阶段就要求传入完整 B，但此时 B 尚未创建，A 连放入三级缓存的机会都没有 → 死循环。

**FactoryBean 机制**：`FactoryBean<T>` 接口用于定制 Bean 的创建逻辑（如 MyBatis Mapper 代理）。`getBean("&xxx")` 获取 FactoryBean 本身，`getBean("xxx")` 获取 FactoryBean 的 `getObject()` 返回值。

---

### Q2：Spring AOP 的原理是什么？JDK 动态代理与 CGLIB 的区别，以及 `@Transactional` 失效的常见场景？
**A：**

**1. AOP 代理创建决策树**

```plain
目标 Bean 是否需要代理？
  │
  ├── 没有匹配的 Advisor（切面/事务）→ 返回原始对象
  │
  └── 匹配到 Advisor → 创建代理
        │
        ├── proxyTargetClass = true（Spring Boot 2.x 默认）
        │     └── CGLIB（即使实现了接口也用 CGLIB）
        │
        └── proxyTargetClass = false
              ├── Bean 实现了接口 → JDK 动态代理
              └── Bean 没有实现接口 → CGLIB
```

**2. JDK vs CGLIB 深度对比**

| 维度 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| **原理** | 基于接口，`Proxy.newProxyInstance()` + `InvocationHandler` | 基于继承，ASM 生成目标类的子类 |
| **限制** | 目标类必须实现接口 | 不能代理 `final` 类/方法 |
| **性能** | 创建快（直接生成字节码），调用略慢（反射） | 创建慢（ASM 生成子类），调用快（直接方法调用） |
| **Spring Boot 2.x** | 默认不选 | 🏆 默认选择 |
| **获取代理** | `AopProxy` 接口的 `JdkDynamicAopProxy` | `CglibAopProxy`，通过 `DynamicAdvisedInterceptor` 拦截 |


**AOP 调用链路**：代理对象 → `JdkDynamicAopProxy.invoke()` / `CglibAopProxy.intercept()` → 获取 Advisor 链（匹配 Pointcut） → `ReflectiveMethodInvocation.proceed()` 依次执行拦截器 → 最终执行目标方法。

**3. @Transactional 失效场景（P7 源码级分析）**

| 场景 | 原因（源码级别） | 解决方案 |
| --- | --- | --- |
| **非 public 方法** | `AbstractFallbackTransactionAttributeSource` 的 `computeTransactionAttribute()` 只处理 public 方法 | 改为 public 或使用 AspectJ 织入 |
| **自调用** | `this.method()` 绕过代理，直接调用目标对象方法。原因：AOP 代理持有的是目标对象的引用，`this` 指向目标对象本身 | `AopContext.currentProxy()` 获取代理；或拆到另一个 Bean；或 `@Autowired` 自己 |
| **异常被 catch** | `TransactionAspectSupport.completeTransactionAfterThrowing()` 只对未捕获的异常回滚 | 手动 `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` |
| **非默认回滚异常** | `RuleBasedTransactionAttribute.rollbackOn()` 默认只对 `RuntimeException` 和 `Error` 返回 true | `@Transactional(rollbackFor = Exception.class)` |
| **多线程** | 事务状态绑定在 `ThreadLocal<TransactionSynchronizationManager>` 中，新线程不共享 | 将事务操作抽取到异步调用的外层 |
| **传播行为** | `NOT_SUPPORTED` / `NEVER` 等会挂起/拒绝事务 | 确认传播行为是否符合业务语义 |


**4. 事务传播行为精讲（P7 核心）**

| 传播行为 | 当前有事务 | 当前无事务 | 典型场景 |
| --- | --- | --- | --- |
| **REQUIRED**（默认） | 加入当前事务 | 新建事务 | 大多数场景 |
| **REQUIRES_NEW** | 挂起当前事务，新建独立事务 | 新建事务 | 日志记录（不受主事务回滚影响） |
| **NESTED** | 创建保存点（Savepoint），嵌套子事务 | 新建事务 | 批量处理中某条失败不影响整体 |
| **SUPPORTS** | 加入当前事务 | 非事务执行 | 查询方法 |
| **NOT_SUPPORTED** | 挂起当前事务 | 非事务执行 | 不需要事务的操作 |
| **MANDATORY** | 加入当前事务 | 抛异常 | 必须在事务中的操作 |
| **NEVER** | 抛异常 | 非事务执行 | 必须在非事务中的操作 |


**REQUIRES_NEW vs NESTED 的关键区别**：REQUIRES_NEW 是完全独立的事务（挂起外层、commit/rollback 互不影响）；NESTED 用的是 Savepoint，子事务回滚只回到保存点，但最终还是和父事务一起提交。

**5. 事务隔离级别与 Spring 映射**

| Spring Isolation | 数据库级别 | 解决的问题 |
| --- | --- | --- |
| DEFAULT | 使用数据库默认（MySQL=REPEATABLE_READ） | — |
| READ_UNCOMMITTED | 读未提交 | 无（存在脏读、不可重复读、幻读） |
| READ_COMMITTED | 读已提交 | 脏读 |
| REPEATABLE_READ | 可重复读 | 脏读 + 不可重复读 |
| SERIALIZABLE | 串行化 | 全部（但性能极差） |


---

### Q3：Spring Boot 自动配置原理是什么？如何自定义一个 starter？启动流程是怎样的？
**A：**

**1. Spring Boot 启动流程**

```plain
@SpringBootApplication
  @SpringBootConfiguration   — 标记为配置类
  @EnableAutoConfiguration   — 自动配置核心
  @ComponentScan             — 扫描当前包及子包

SpringApplication.run()
  ├─ 1. 创建 SpringApplication 实例
  │    └─ 从 spring.factories 加载 ApplicationContextInitializer、ApplicationListener
  ├─ 2. 准备 Environment（命令行参数、系统属性、环境变量等）
  ├─ 3. 创建 ApplicationContext
  ├─ 4. 准备 Context：执行所有 ApplicationContextInitializer
  ├─ 5. refresh() → 进入 Spring IOC 容器启动流程（见 Q1）
  │    └─ onRefresh() → createWebServer() → 启动内嵌 Tomcat
  └─ 6. 执行 ApplicationRunner / CommandLineRunner
```

**2. 自动配置原理（三步走）**

```plain
① @EnableAutoConfiguration
   └─ @Import(AutoConfigurationImportSelector.class)
        └─ selectImports()
             └─ SpringFactoriesLoader.loadFactoryNames(EnableAutoConfiguration.class)
                  └─ 读取所有 jar 的 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
                     （Spring Boot 3.x 新格式，旧版用 spring.factories）
② 加载到的 xxxAutoConfiguration 类上标注了:
   └─ @Configuration
   └─ @ConditionalOnClass — 类路径存在才生效
   └─ @ConditionalOnProperty — 配置开关
   └─ @ConditionalOnMissingBean — 用户自定义了就不创建默认 Bean
③ 条件满足 → 创建 @Bean → 注入容器
```

**3. 自定义 starter 的工业级设计**

```plain
项目结构:
my-starter/
├── my-spring-boot-autoconfigure/       ← 自动配置模块
│   ├── src/main/java/com/xxx/
│   │   ├── MyAutoConfiguration.java    ← @Configuration + @ConditionalOnXxx
│   │   ├── MyProperties.java           ← @ConfigurationProperties(prefix = "my")
│   │   └── MyService.java              ← 核心业务逻辑
│   └── src/main/resources/
│       └── META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
└── my-spring-boot-starter/             ← 空模块，仅 pom.xml 依赖 autoconfigure
```

**关键设计原则：**

+ **依赖隔离**：autoconfigure 模块中第三方依赖使用 `optional`，避免污染用户项目。
+ **配置校验**：`@ConfigurationProperties` + `@Validated` + `javax.validation` 校验前置。
+ **条件装配**：`@ConditionalOnClass` 确保依赖存在才加载；`@ConditionalOnMissingBean` 允许用户覆盖。
+ **启用注解**：提供 `@EnableMyFeature` 让用户显式启用。
+ **IDE 提示**：添加 `spring-configuration-metadata.json`，让 application.yml 有自动补全。

**4. @Conditional 注解族实战**

| 注解 | 使用场景 |
| --- | --- |
| `@ConditionalOnClass` | 引入中间件客户端时（如 `Redisson.class` 存在才创建 RedissonClient） |
| `@ConditionalOnMissingBean` | 允许用户自定义覆盖（如用户定义了自定义 RestTemplate 则不用默认的） |
| `@ConditionalOnProperty` | 功能开关（如 `my.starter.enabled=true`） |
| `@ConditionalOnBean` | 依赖其他 Bean 存在（如 DataSource 存在才创建 JdbcTemplate） |
| `@ConditionalOnExpression` | 复杂条件（如 `${my.type} == 'redis'`） |
| `@ConditionalOnWebApplication` | 区分 Web/Servlet/Reactive 环境 |


---

### Q4：Nacos 和 Eureka 在服务发现上的核心区别是什么？Nacos 的 CP 模式如何实现？配置中心动态刷新原理？
**A：**

**1. Nacos vs Eureka 核心对比**

| 维度 | Nacos | Eureka |
| --- | --- | --- |
| **CAP 模型** | 同时支持 AP 和 CP，可切换 | 仅 AP |
| **一致性协议** | CP 模式使用简化的 Raft（或 Distro AP 协议） | 无选主，节点对等，Peer-to-Peer 复制 |
| **健康检查** | 临时实例（心跳）+ 持久化实例（服务端主动探测） | 客户端心跳 + 服务端租约过期 |
| **实例类型** | 临时实例（ephemeral=true，默认）+ 持久化实例（ephemeral=false，CP 模式） | 仅临时 |
| **功能边界** | 注册中心 + 配置中心 + DNS | 仅注册中心 |
| **保护机制** | 阈值保护（健康实例比例低于阈值不剔除） | 自我保护模式（不剔除任何实例） |
| **CAP 切换** | `spring.cloud.nacos.discovery.ephemeral=false` → CP | 不可切换 |


**2. Nacos 的 CP 模式切换意味着什么？**

+ **AP 模式（默认）**：临时实例心跳丢失后立即剔除。Nacos 使用自研的 **Distro 协议**（基于内存的异步复制，类似 Gossip），保证高可用。
+ **CP 模式**：持久化实例使用**简化的 Raft 协议**。实例注册持久化到磁盘，集群多数派确认。心跳超时不立即剔除，仅标记不健康。
+ **选型原则**：微服务间调用（允许短暂不可用）→ AP；核心服务、需强一致的场景（如支付服务的实例列表）→ CP。

**3. Nacos 配置中心动态刷新原理**

```plain
┌──────────────┐     长轮询(30s超时)     ┌──────────────┐
│ Nacos Client │ ◄────────────────────► │ Nacos Server │
│              │   MD5值比较 + 配置内容    │              │
└──────┬───────┘                          └──────┬───────┘
       │ 配置变更通知                              │ 配置变更
       ▼                                          ▼
┌──────────────┐                          ┌──────────────┐
│ RefreshEvent │                          │   MySQL/     │
│   发布       │                          │  Derby 存储  │
└──────┬───────┘                          └──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ @RefreshScope Bean 监听到 RefreshEvent │
│ → 销毁旧 Bean → 下次访问时重新创建     │
└──────────────────────────────────────┘
```

**@RefreshScope vs @ConfigurationProperties：**

| 方式 | 原理 | 适用场景 |
| --- | --- | --- |
| `@RefreshScope` | 代理 Bean，监听 RefreshEvent 销毁 → 延迟重建 | 需要完整重建 Bean 的场景（如数据源切换） |
| `@ConfigurationProperties` | Spring Boot 3.x 中默认支持热更新，直接修改属性值 | 普通配置项（timeout、limit 等），推荐 |


**注意**：`@Value` 注入的属性**不会**自动刷新，除非所在 Bean 标注了 `@RefreshScope`。

**4. 配置灰度发布（P7 场景）**

+ 利用 Nacos 的**命名空间（Namespace）**隔离：`dev` / `staging` / `prod`。
+ 配置标签（Tag）：同一 Namespace 内对不同机器的配置打标签，实现灰度。
+ 最佳实践：配置变更先发 staging → 验证通过 → 发 prod → 保留上一版本配置快照以便回滚。

---

### Q5：负载均衡策略有哪些？Feign 的调用流程及如何设计一个生产级远程调用框架？
**A：**

**1. Ribbon → Spring Cloud LoadBalancer 演进**

+ Ribbon 已停止维护，Spring Cloud 2020.0 起推荐 **Spring Cloud LoadBalancer**。
+ Spring Cloud LoadBalancer 提供 `RoundRobinLoadBalancer`、`RandomLoadBalancer`，支持实现 `ReactorServiceInstanceLoadBalancer` 自定义。

**2. 负载均衡策略对比**

| 策略 | 原理 | 适用场景 |
| --- | --- | --- |
| **RoundRobin** | 轮询 | 服务实例性能一致的通用场景 |
| **Random** | 随机 | 简单场景 |
| **WeightedResponseTime** | 按最近平均响应时间加权 | 实例性能不均 |
| **BestAvailable** | 选并发请求最少的实例 | 短连接，请求耗时不均 |
| **ConsistentHash** | 按请求参数哈希选择同一实例 | 需要粘性会话（如缓存命中） |
| **ZoneAvoidance** | 复合判断区域可用性和性能 | 跨机房部署 |


**3. Feign 调用全流程**

```plain
@FeignClient(name = "order-service")
  ↓
FeignClientFactoryBean → 为每个接口创建 JDK 代理
  ↓
FeignInvocationHandler.invoke() — 拦截方法调用
  ↓
① 构建 RequestTemplate（方法元数据 → HTTP 方法、URL、参数、Header）
  ↓
② 执行 RequestInterceptor 链（添加认证 Token、TraceId、自定义 Header）
  ↓
③ LoadBalancerClient.choose("order-service") — 从 Nacos 获取实例列表 → 负载均衡选实例
  ↓
④ Client（HttpURLConnection / OkHttp / Apache HttpClient）执行 HTTP 请求
  ↓
⑤ Decoder（Jackson / Gson）反序列化响应 → 返回对象
  ↓
⑥ ErrorDecoder → 处理 HTTP 错误码（4xx/5xx）→ 抛出对应异常
```

**4. 生产级远程调用框架设计要点（P7 视角）**

| 要点 | 方案 |
| --- | --- |
| **超时配置** | 连接超时（connectTimeout）+ 读取超时（readTimeout），区分不同服务的超时时间 |
| **重试策略** | 仅对幂等请求（GET）重试，非幂等请求（POST）需配合幂等 key，重试次数 ≤ 3 |
| **熔断降级** | Sentinel / Resilience4j CircuitBreaker，慢调用比例/异常比例熔断 |
| **链路追踪** | RequestInterceptor 自动传递 TraceId → 全链路可追踪 |
| **线程池隔离** | 不同服务使用不同线程池，防止一个服务拖垮整个系统 |
| **监控告警** | Micrometer 记录调用耗时、成功率、QPS → Prometheus + Grafana |


**RestTemplate vs WebClient vs Feign 对比：**

| 特性 | RestTemplate | WebClient | Feign |
| --- | --- | --- | --- |
| 底层 | Servlet 同步阻塞 | Reactor 非阻塞 | 封装 RestTemplate/WebClient |
| 声明式 | ❌ | ❌ | ✅ 注解驱动 |
| 负载均衡 | 需 `@LoadBalanced` | 需 `@LoadBalanced` | 内置集成 |
| 适用 | 旧项目、简单调用 | 响应式栈（WebFlux） | 微服务间调用 |


---

### Q6：Spring Cloud Gateway 的核心原理是什么？与 Zuul 1.x 对比有何优势？如何实现动态路由和自定义过滤器？
**A：**

**1. Gateway 处理全流程（基于 WebFlux 非阻塞）**

```plain
客户端请求
  │
  ▼
ReactorHttpHandlerAdapter
  │
  ▼
HttpWebHandlerAdapter → WebHandler（核心入口）
  │
  ▼
RoutePredicateHandlerMapping.lookupRoute()
  └─ RouteLocator.getRoutes() → 匹配 Predicate（路径、Header、参数等）
       ↓ 匹配到 Route
  ▼
FilteringWebHandler.handle()
  └─ 构建过滤器链（GlobalFilter + GatewayFilter）
       │
       ├─ ① 前置过滤器（鉴权、限流、请求重写）
       ├─ ② NettyRoutingFilter → 转发到下游服务
       └─ ③ 后置过滤器（响应头修改、日志记录）
  │
  ▼
NettyWriteResponseFilter → 写回响应给客户端
```

**2. Gateway vs Zuul 1.x 性能差异的根源**

| 维度 | Zuul 1.x | Spring Cloud Gateway |
| --- | --- | --- |
| **IO 模型** | Servlet 同步阻塞，每个请求一个线程 | Netty + Reactor 异步非阻塞，EventLoop 线程组 |
| **线程开销** | 线程池满则拒绝请求 | 少量线程处理海量连接 |
| **路由性能** | 毫秒级 | 微秒级（无上下文切换） |
| **与 Spring 集成** | 需单独维护 | 深度集成：Actuator、配置中心、服务发现 |


**Gateway 线程模型**：Netty Boss Group（接收连接）→ Worker Group（处理 IO）→ EventLoop 线程处理请求，零上下文切换。

**3. 动态路由实现**

```java
// 实现 RouteDefinitionRepository 从 DB/配置中心加载路由
@Component
public class DbRouteDefinitionRepository implements RouteDefinitionRepository {
    @Override
    public Flux<RouteDefinition> getRouteDefinitions() {
        // 从 MySQL/Redis/Nacos 加载路由定义
        List<RouteDefinition> routes = dbService.findAllRoutes();
        return Flux.fromIterable(routes);
    }
    // 通过 ApplicationEventPublisher 发布 RefreshRoutesEvent 触发刷新
}
```

+ **实时生效**：调用 `publishEvent(new RefreshRoutesEvent(this))` 后路由立即更新，无需重启。
+ **最佳实践**：路由定义存储在 Nacos 配置中心 → Nacos 变更通知 → 消费通知 → 发布 RefreshRoutesEvent。

**4. 自定义过滤器设计（全局 + 局部）**

```java
// 全局过滤器：统一鉴权
@Component
public class AuthGlobalFilter implements GlobalFilter, Ordered {
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (StringUtils.isEmpty(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        // 验证 token → 解析用户信息 → 写入 Header 传给下游
        exchange = exchange.mutate()
            .request(r -> r.header("X-User-Id", userId))
            .build();
        return chain.filter(exchange);
    }
    @Override
    public int getOrder() { return -100; } // 越小越先执行
}
```

**5. Gateway 内置过滤器工厂**

| Filter | 功能 | 配置示例 |
| --- | --- | --- |
| `RequestRateLimiter` | 基于 Redis 令牌桶限流 | `name: RequestRateLimiter, args: {redis-rate-limiter.replenishRate: 100}` |
| `CircuitBreaker` | 集成 Resilience4j 熔断 | `name: CircuitBreaker, args: {name: myCB}` |
| `RewritePath` | 路径重写 | `name: RewritePath, args: {regexp: /api/(?<segment>.*)}` |
| `StripPrefix` | 去除路径前缀 | `name: StripPrefix, args: {parts: 1}` |
| `Retry` | 重试 | `name: Retry, args: {retries: 3}` |


---

### Q7：Sentinel 的限流算法有哪些？滑动窗口和令牌桶的实现原理，以及熔断降级和隔离策略？
**A：**

**1. 限流算法四维对比**

| 算法 | 原理 | 特点 | Sentinel 实现 |
| --- | --- | --- | --- |
| **固定窗口** | 固定时间段计数，超阈值限流 | 临界问题（窗口切换时双倍流量） | 不推荐 |
| **滑动窗口** | 将窗口划分为多个小窗口，随时间滑动统计 | 精确平滑，避免临界问题 | 🏆 默认限流算法 |
| **漏桶** | 固定速率处理请求 | 绝对平滑，无法应对突发流量 | RateLimiterController 可模拟 |
| **令牌桶** | 固定速率生成令牌，可积攒 | 允许一定突发 | WarmUpController（预热模式） |


**2. 滑动窗口核心实现（LeapArray）**

```plain
时间轴: ├────┼────┼────┼────┤  （窗口长度 1s，划分为 2 个 500ms 小窗口）

┌─────────────────────────────────┐
│ 环形数组 WindowWrap[2]          │
│  [0]: 0ms~500ms  → pass: 50    │ ← 旧窗口（滑动后淘汰）
│  [1]: 500ms~1000ms → pass: 30  │ ← 当前窗口
└─────────────────────────────────┘
             │
    currentTimeMs → 计算数组索引 → CAS 递增计数器
    └─ 超出窗口 → 重置旧窗口 → 累加所有窗口 pass 数
       └─ sum > threshold → 限流！
```

核心优势：**无锁 CAS 操作** + **O(1) 窗口滑动**（重置到新时间窗口即可）。

**3. Sentinel 三种流控模式**

| 模式 | 原理 | 适用场景 |
| --- | --- | --- |
| **直接模式** | 当前资源达到阈值直接限流 | 通用场景 |
| **关联模式** | 关联资源达到阈值时，对当前资源限流 | 支付接口 QPS 过高时，对下单接口限流 |
| **链路模式** | 只统计从入口资源进入的调用 | 某个接口有多条调用路径，只限流其中一条 |


**4. 令牌桶与预热模式**

+ **匀速排队（RateLimiterController）**：请求先计算"预期通过时间"，当前时间 < 预期时间则 `sleep`。严格平滑流量，类似漏桶但不丢弃令牌。
+ **预热模式（WarmUpController）**：基于 Guava 的 `SmoothWarmingUp` 思想。冷启动阶段令牌生成速率低，防止系统被突发流量冲垮。

**5. 熔断降级策略**

| 策略 | 判定条件 | 适用场景 |
| --- | --- | --- |
| **慢调用比例** | `slowRatio > threshold`（如 50% 调用耗时 > 200ms） | 下游服务变慢，快速熔断防止雪崩 |
| **异常比例** | `errorRatio > threshold`（如 50% 调用抛异常） | 下游服务异常 |
| **异常数** | `errorCount > threshold`（如 1 分钟内 5 次异常） | 低流量场景（异常比例不准确） |


熔断器状态机：**Closed → Open（熔断触发）→ Half-Open（放行少量探测请求）→ Closed/Open**

**6. 隔离策略**

| 策略 | 实现 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **信号量隔离**（Sentinel 默认） | 本地计数器控制并发数 | 零线程开销、非阻塞 | 不隔离调用线程 |
| **线程池隔离** | 独立线程池执行 | 完全隔离，一个服务不拖累全局 | 线程切换开销、延迟增加 |


Sentinel 推荐信号量隔离 + 异步化：减少线程开销，结合响应式编程发挥非阻塞优势。

**7. Sentinel vs Hystrix vs Resilience4j — P7 选型**

| 维度 | Hystrix（已停维） | Sentinel | Resilience4j |
| --- | --- | --- | --- |
| 限流 | 信号量/线程池 | 滑动窗口 QPS/线程数，更丰富 | RateLimiter（令牌桶） |
| 熔断 | 基于 HystrixCircuitBreaker | SLOW_REQUEST_RATIO 等 3 种 | 慢调用/失败率 |
| 控制台 | Dashboard（简陋） | Sentinel Dashboard（功能强大） | 无内置，需自行集成 |
| 社区 | 已停维 | 阿里维护，活跃 | 活跃，轻量级 |
| 推荐 | ❌ 不建议新项目 | 🏆 Java 微服务首选 | 轻量场景备选 |


---

### Q8：分布式事务 Seata 的 AT、TCC、Saga 模式原理及选型？
**A：**

> 本篇与「八、分布式系统原理与架构设计」的 Q10 互补。本篇侧重 **Seata 的工程实现细节**，Q10 侧重**方案全景对比**。
>

**1. Seata 整体架构**

```plain
TM (Transaction Manager)         — @GlobalTransactional 发起方
  │
  ├─► TC (Transaction Coordinator) — Seata Server，全局事务协调
  │
  └─► RM (Resource Manager)        — 各微服务分支事务参与者
```

**2. AT 模式深入**

+ **一阶段**：执行 SQL → 自动记录 undo_log（前镜像: beforeImage）→ 提交本地事务 → 释放本地锁 → 注册分支事务。
+ **二阶段-提交**：TC 决定全局提交 → 异步删除各 RM 的 undo_log。
+ **二阶段-回滚**：TC 决定全局回滚 → 各 RM 根据 undo_log 的后镜像（afterImage）生成反向 SQL → 补偿回滚。
+ **全局锁**：AT 模式通过 Seata 的全局锁表防止脏写。一阶段提交后，其他全局事务的修改需要等全局锁释放（二阶段完成后）。

**3. TCC 模式深入**

```plain
Try:      冻结库存（可用 - 1，冻结 + 1）
Confirm:  确认扣减（冻结 - 1）
Cancel:   释放冻结（冻结 - 1，可用 + 1）
```

**TCC 的设计难点（P7 必问）：**

+ **空回滚**：Try 还没执行就收到 Cancel（由于网络延迟/重试）。解决方案：Cancel 执行前检查 Try 是否有记录，没有则直接返回成功。
+ **悬挂**：Cancel 先到达并执行，然后延迟的 Try 到达。解决方案：Try 执行前检查是否已被 Cancel，如果被 Cancel 过则拒绝 Try。
+ **幂等控制**：Confirm/Cancel 可能被重复调用，需基于唯一键（xid + branchId）做去重。

**4. Saga 模式的实现模式对比**

| 维度 | 编排式（Choreography） | 控制式（Orchestration） |
| --- | --- | --- |
| 调用方式 | 事件驱动，各服务监听事件自行处理 | 中央 Saga 协调器调用各服务 |
| 耦合度 | 松散，服务间通过事件通信 | 协调器依赖所有服务 API |
| 可观测性 | 差，流程分散在多个服务 | 好，协调器能看到完整流程 |
| 适用场景 | 简单流程（3-5 步） | 复杂流程，需要统一管控 |


**5. 选型决策**

```plain
需要跨服务事务？
  │
  ├── 传统单体拆分，使用关系型 DB，不想改代码？
  │     └── AT 模式（零侵入）
  │
  ├── 核心链路（资金/库存），需要高性能、精确控制？
  │     └── TCC（需投入开发成本实现 Try/Confirm/Cancel）
  │
  ├── 长流程、异构系统（外部 API）、无法改造？
  │     └── Saga + 补偿（需自行实现补偿逻辑）
  │
  └── 不需要分布式事务，只需最终一致+对账？
        └── 本地消息表 / 事务消息（参见分布式系统 Q10）
```

---

### Q9（P7 开放题）：请比较几种 API 网关方案，并设计一套灰度发布/蓝绿部署系统。
**A：**

**1. API 网关方案对比**

| 网关 | 编程模型 | 性能 | 生态 | 适用场景 |
| --- | --- | --- | --- | --- |
| **Spring Cloud Gateway** | WebFlux 非阻塞 | 高 | Spring 深度集成 | Java 微服务体系首选 |
| **Zuul 1.x** | Servlet 阻塞 | 中 | Netflix OSS | 遗留项目 |
| **Kong** | Nginx/OpenResty（Lua） | 极高 | 插件丰富（认证/限流/日志） | 多语言异构、高性能 |
| **APISIX** | Nginx/OpenResty（Lua/Go/Wasm） | 极高 | 插件丰富，支持多语言 | 云原生、高性能企业级 |
| **Traefik** | Go 语言 | 高 | 容器原生（K8s/Docker 自动发现） | K8s 环境 |
| **Nginx + Lua** | Nginx + LuaJIT | 最高 | 需自研 | 简单转发或有专业运维 |


**P7 决策法则**：纯 Java 微服务 → Gateway；多语言 + 高性能 → Kong/APISIX；K8s 原生 → Traefik。

**2. 灰度发布（金丝雀）完整设计方案**

```plain
                    ┌─────────────┐
                    │  Nacos 配置  │ ← 存储灰度规则
                    └──────┬──────┘
                           │
用户请求 ──► Gateway ──► LoadBalancer ──► 服务实例
               │                │
               │  灰度规则判断    │  实例元数据(version: v1/v2)
               │                │
        ┌──────┴──────┐  ┌─────┴─────┐
        │ 规则匹配策略  │  │ 权重策略   │
        └─────────────┘  └───────────┘
```

**灰度策略矩阵：**

| 策略 | 实现 | 精确度 | 适用场景 |
| --- | --- | --- | --- |
| **Header 路由** | `X-Canary: true` → 路由到灰度版本 | 精确到请求 | 内部测试验证 |
| **Cookie 染色** | 特定 Cookie → 路由到灰度版本 | 精确到用户 | 用户白名单灰度 |
| **用户 ID 哈希** | `hash(userId) % 100 < 10` → 灰度 | 10% 流量 | 按比例灰度 |
| **权重分配** | Nacos 实例权重：v1=90, v2=10 | 10% 流量 | 逐步放量 |
| **全链路灰度** | TraceId + 流量标签在整个调用链中透传 | 全链路 | 微服务全链路灰度 |


**3. 全链路灰度实现**

```plain
用户请求（Header: traffic-tag=gray）
  │
  ▼
Gateway → 识别灰度流量 → 转发给灰度实例
  │
  ▼
Service A(gray) → Feign 拦截器 → 自动透传 traffic-tag=gray → Service B(gray) → Service C(gray)
```

+ **关键**：在 Feign `RequestInterceptor` 中自动透传灰度标识。
+ **实现**：`RequestContextHolder` 存储当前请求的灰度标签，Feign 调用时自动注入 Header。

**4. 蓝绿部署全流程**

```plain
蓝环境(v1)                           绿环境(v2)
┌──────────┐                        ┌──────────┐
│ 100% 流量 │ ──── 切换 ────►        │ 100% 流量 │
└──────────┘                        └──────────┘
                                           │
                              监控 5 分钟无异常 → 成功
                              异常 → 秒级切回蓝环境
```

+ **资源**：两套完整环境（需要双倍资源）。
+ **DB 兼容**：v2 的 DB schema 变更必须向前兼容（v1 也能正常读写）。
+ **切流方式**：修改 Nacos 路由指向，或修改 Gateway 路由规则。

---

### Q10（P7 选型题）：微服务拆分粒度如何把握？如何评估一个分布式系统的技术选型？
**A：**

**1. 服务拆分粒度 — DDD 限界上下文**

+ **原则**：按**业务边界**拆分，一个微服务对应一个 DDD 限界上下文（Bounded Context）。
+ **信号**：一个"模块"有自己的数据存储、独立部署节奏、独立的团队可以维护 → 可以拆为独立服务。
+ **粒度判断陷阱**：
    - 太细 → 分布式事务爆炸、调用链过长、运维成本激增（"微服务地狱"）。
    - 太粗 → 回到单体困境：部署耦合、扩展不灵活。

**P7 拆分检查清单：**

+ 是否可以独立部署、独立扩缩容？
+ 是否有独立的数据库（或至少独立的 Schema）？
+ 是否能由一个 2~5 人的小团队独立维护？
+ 跨服务调用是否异步化（避免同步调用链过长）？

**2. Strangler Fig 模式（单体→微服务渐进式迁移）**

```plain
单体应用
┌──────────────┐     ┌──────────────┐
│  订单模块    │ ──► │ 订单微服务    │   ① 先拆分新功能
│  用户模块    │     │ (独立部署)    │
│  支付模块    │ ──► │ 支付微服务    │   ② 逐步迁移旧功能
└──────────────┘     └──────────────┘
Gateway 流量逐步从单体切到新微服务        ③ 最终下线单体
```

**3. 何时引入 API 网关和消息队列**

**BFF（Backend For Frontend）模式详解**：

```plain
移动APP ──► BFF-Mobile ──► 商品服务
                          ├─► 订单服务
                          └─► 用户服务
                          （聚合多个服务数据，裁剪字段）

Web前端 ──► BFF-Web ──► 同样的后端服务
                        （不同裁剪策略，不同聚合逻辑）
```

| 维度 | 传统 API Gateway | BFF |
| --- | --- | --- |
| 定位 | 统一入口（鉴权/限流/路由） | 为特定前端定制的聚合层 |
| 字段裁剪 | 透传 | 按前端需求裁剪（移动端少字段） |
| 聚合能力 | 简单 | 多服务数据聚合为一个响应 |
| 适用 | 通用场景 | 多端（APP/Web/小程序）差异大时 |


> P7 建议：BFF 不是银弹——增加一层就增加运维成本。只有多端差异显著时才引入。
>

+ **消息队列**：业务需要异步解耦（发邮件/短信）、削峰填谷（秒杀）、保证最终一致性、事件驱动架构（CQRS）。

**4. 技术选型评估框架**

| 评估维度 | 权重 | 关键问题 |
| --- | --- | --- |
| **业务需求** | ⭐⭐⭐⭐⭐ | QPS 量级？一致性要求？延迟要求？数据量？ |
| **团队能力** | ⭐⭐⭐⭐ | 团队熟悉度？学习曲线？社区活跃度？ |
| **生态兼容** | ⭐⭐⭐ | 与现有系统集成难度？语言栈匹配？ |
| **可运维性** | ⭐⭐⭐⭐ | 监控/部署/扩展的便利性？是否有管理控制台？ |
| **成本** | ⭐⭐⭐ | 人力/机器/许可证/云服务费用？ |


**选型案例**：配置中心选 Nacos 还是 Apollo？

+ 团队有阿里技术栈经验 → Nacos（兼具服务发现，能力一体）。
+ 仅为配置管理、不需要服务发现、携程系团队 → Apollo（配置管理更成熟，灰度发布更强）。

---

### Q11（新增 — 可观测性）：微服务体系中如何构建可观测性？指标、链路、日志三大支柱如何落地？
**A：**

**1. 可观测性三大支柱**

```plain
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Metrics    │  │   Tracing    │  │    Logging   │
│   指标       │  │   链路追踪   │  │    日志      │
├──────────────┤  ├──────────────┤  ├──────────────┤
│ 全局聚合视图  │  │ 单次请求路径  │  │ 详细事件记录  │
│ Prometheus   │  │ Zipkin/      │  │ ELK / Loki   │
│ + Grafana    │  │ Jaeger       │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

**2. 指标监控 (Metrics)**

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  metrics:
    tags:
      application: ${spring.application.name}
    export:
      prometheus:
        enabled: true
```

**P7 必设的核心指标：**

| 指标类型 | 指标名 | 含义 | 告警阈值 |
| --- | --- | --- | --- |
| **QPS** | `http.server.requests.count` | 每秒请求量 | 超容量上限 80% 告警 |
| **延迟** | `http.server.requests.duration` (p99) | 接口响应时间 | p99 > 500ms 告警 |
| **错误率** | status: 5xx | 错误比例 | > 1% 告警 |
| **JVM GC** | `jvm.gc.pause` | GC 暂停时间 | p99 > 100ms 告警 |
| **JVM 内存** | `jvm.memory.used` | 堆内存使用率 | > 85% 告警 |
| **线程池** | `tomcat.threads.busy` | 繁忙线程数 | > 80% 告警 |
| **连接池** | `hikaricp.connections.active` | 活跃连接数 | > 80% 告警 |


**3. 链路追踪 (Tracing)**

```plain
请求进入 Gateway
  │  TraceId: abc123, SpanId: 001
  ▼
Service A
  │  TraceId: abc123, SpanId: 002 (parent: 001)
  ▼
Service B
  │  TraceId: abc123, SpanId: 003 (parent: 002)
  ▼
Service C (DB / Redis / MQ)
     TraceId: abc123, SpanId: 004 (parent: 003)
```

**TraceId 自动透传**：Gateway 的 `ReactorContext` → Feign 的 `RequestInterceptor` → MQ 的 Header → 线程池的 `MdcContextPropagator`。**关键**：跨线程时一定要传播 MDC 上下文。

**4. 日志聚合 (Logging)**

+ **格式**：JSON 结构化日志（方便 ELK/Loki 解析）。
+ **必要字段**：`timestamp, level, service, traceId, spanId, class, message, stacktrace`。
+ **生产实践**：日志输出到 stdout → Filebeat/Fluentd 采集 → Elasticsearch + Kibana 或 Loki + Grafana。

---

### Q12（新增 — 生产排障）：线上出现 CPU 飙高、OOM、慢接口等异常，如何进行系统性排查？
**A：**

**1. 系统性排障方法论（从现象到根因）**

```plain
┌─────────────────────────────────────────────────────┐
│          一级指标（先看全局，快速定位）               │
│  CPU 使用率 / 内存使用率 / 磁盘 IO / 网络带宽        │
└────────────────────────┬────────────────────────────┘
                         │ 异常的方向
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌───────────┐    ┌───────────┐    ┌───────────┐
│  CPU 飙高  │    │  内存/OOM │    │ 慢接口    │
└─────┬─────┘    └─────┬─────┘    └─────┬─────┘
      │                │                │
      ▼                ▼                ▼
  深入排查流程      深入排查流程      深入排查流程
```

**2. CPU 飙高排查**

```plain
① top -Hp <pid>                    → 找到 CPU 最高的线程 PID
② printf "%x\n" <tid>              → 转为十六进制
③ jstack <pid> | grep -A 20 <hex>  → 打印线程堆栈
④ 定位代码                          → 是死循环？正则回溯？GC 线程？
```

常见根因：死循环/while(true)、正则表达式回溯、频繁 FGC、JSON 超大对象序列化。

**3. 内存泄漏 / OOM 排查**

```plain
① jmap -histo:live <pid> | head -30  → 查看存活对象 Top 30
② jmap -dump:format=b,file=heap.bin <pid> → Dump 堆内存
③ 用 MAT / JProfiler 分析 heap.bin    → 找到大对象 / GC Root 引用链
④ jstat -gcutil <pid> 1000            → 实时观察 GC 频率和耗时
```

常见根因：ThreadLocal 未清理、HashMap 不断累积未删除、数据库连接池泄漏、大量静态集合缓存。

**4. 慢接口排查**

```plain
① APM 看 TraceId 链路                → 定位慢在哪个 Span（哪次调用）
② Arthas trace 命令                  → 精确到方法级别的耗时分布
    trace com.xxx.Service methodName  → 打印方法内部各步骤耗时
③ Arthas watch 命令                  → 观察入参出参
④ SQL 慢查询日志                      → 是否缺少索引、全表扫描
⑤ 网络耗时排查                        → 跨机房延迟？下游服务慢？
```

**P7 面试策略**：不是只说"我查过日志"，而是能展现**分层排查的系统性方法**：先看全局指标 → 定位异常类型 → 用工具深入 → 找到根因代码 → 给出根治方案（而不仅仅是重启）。

---

### Q13（新增 — SpringMVC 与 MyBatis 高频八股）：SpringMVC 的处理流程？Filter、Interceptor、AOP 的区别？MyBatis 的 # 与 $ 的区别？一级二级缓存？
**A：**

**1. SpringMVC 处理流程（DispatcherServlet 核心）**

```plain
请求 → DispatcherServlet
  │
  ├─ ① HandlerMapping 找到处理器（@RequestMapping 映射）
  ├─ ② HandlerAdapter 调用处理器方法（适配不同 Controller 类型）
  ├─ ③ 参数解析 + 数据绑定（@RequestParam/@RequestBody 转换器）
  ├─ ④ 执行业务逻辑，返回 ModelAndView
  ├─ ⑤ ViewResolver 解析视图（或 @ResponseBody 直接写 JSON）
  └─ ⑥ 视图渲染 / HttpMessageConverter 输出响应
```

九大组件：HandlerMapping、HandlerAdapter、HandlerExceptionResolver、ViewResolver、LocaleResolver、ThemeResolver、MultipartResolver、FlashMapManager、RequestToViewNameTranslator。

**2. Filter vs Interceptor vs AOP**

| 维度 | Filter | Interceptor | AOP |
| --- | --- | --- | --- |
| 层级 | Servlet 容器层（Tomcat） | Spring MVC 层 | Spring Bean 层 |
| 入口 | doFilter 链 | preHandle/postHandle | 切点+通知 |
| 能拿到 | ServletRequest/Response | Handler（Controller 方法） | Bean 方法 |
| 场景 | 编码、跨域、鉴权、限流 | 登录态校验、日志统计 | 事务、缓存、权限注解 |


**3. MyBatis # 与 $ 的区别**：`#{id}` 是**预编译占位符**（PreparedStatement，参数替换为 ?，自动加引号，**防 SQL 注入**）；`${id}` 是**字符串拼接**（直接替换进 SQL，有注入风险）。原则：参数一律用 #，只有动态表名/列名/ORDER BY 字段等无法占位的场景才用 $（且必须白名单校验）。传统 JDBC 对比：MyBatis 免去手动注册驱动/建连接/写 ResultSet 映射，SQL 与代码解耦、动态 SQL 灵活。

**4. MyBatis 一级/二级缓存**：

| 维度 | 一级缓存 | 二级缓存 |
| --- | --- | --- |
| 范围 | SqlSession（默认开启） | Mapper 命名空间（默认关闭） |
| 失效 | 增删改操作、close/clearCache | 跨 Session 共享，需序列化 |
| 风险 | 脏读（同 Session 内） | 跨 Session 脏数据，生产慎用 |


**5. MyBatisPlus**：基于 MyBatis 的增强——通用 CRUD（BaseMapper 免写 XML）、条件构造器（Wrapper）、分页插件、逻辑删除/乐观锁/代码生成器。适用快速 CRUD 场景；复杂 SQL 仍用 MyBatis 原生。

**6. MyBatis 中的设计模式**：Builder（SqlSessionFactoryBuilder）、工厂（SqlSessionFactory）、动态代理（Mapper 接口代理）、模板方法（BaseExecutor）、装饰器（Cache 的 PerpetualCache→LruCache 包装）、责任链（拦截器插件链 InterceptorChain）。

**高频追问**：

| 问题 | 答案 |
| --- | --- |
| Bean 是否单例？作用域？ | 默认 singleton；另有 prototype（每次新建，只管理创建不管理销毁）、request/session/application（Web） |
| Spring 容器里存的是什么？ | Bean 实例——单例池 Map（beanName → 实例） |
| Bean 加载/销毁前后扩展？ | @PostConstruct/@PreDestroy、InitializingBean/DisposableBean、BeanPostProcessor、Aware 接口 |
| Spring 事务 this 调用生效吗？ | 不生效——同类内部调用绕过代理；解决：注入自身代理或 AopContext.currentProxy() |


---

## 🎯 P7 面试之 STAR 映射：把知识变成故事
| 知识点 | STAR 锚点 | 一句话 |
| --- | --- | --- |
| IOC/循环依赖 | Bean 启动优化经验 | "启动慢排查发现 @Lazy 没生效，通过 BeanFactoryPostProcessor 延迟加载非核心 Bean" |
| AOP/事务 | 事务失效排查经历 | "自调用导致事务不生效，通过 AopContext.currentProxy() 解决，并制定代码规范禁止类内部 @Transactional 自调用" |
| 自动配置 | 自定义 starter 经验 | "封装了内部 RPC 框架的 starter，通过 @ConditionalOnProperty 控制启用、自动注册 Bean" |
| 注册中心 | Nacos 选型和运维 | "选 Nacos 是因为团队有阿里技术栈，用 ephemeral=false 保障核心服务的注册强一致性" |
| 网关 | API 网关架构设计 | "全链路灰度通过 Gateway + Feign 拦截器透传流量标签实现，支持 Header/Cookie/用户ID 三种策略" |
| 限流降级 | 大促保障经验 | "结合预热令牌桶 + 慢调用熔断，保障服务的稳定性" |
| 分布式事务 | 核心业务事务选型 | "支付流程对比 AT 和 TCC 后选了 TCC，因为需要精确控制库存回滚和 Cancel 幂等" |
| 可观测性 | 排障体系建设 | "从零搭建了 Prometheus + Grafana + Zipkin 体系，关键接口 p99 从 2s 降到 200ms" |
| 生产排障 | 故障处理复盘 | "内存泄漏通过 jmap + MAT 分析，定位到 ThreadLocal 没清理，修复后夜间不再重启" |


---

## 📚 扩展阅读
+ 《Spring 揭秘》王福强 — IOC/AOP 实现细节
+ 《Spring Boot 编程思想》小马哥 — 自动配置和启动流程深度剖析
+ Sentinel Wiki — 滑动窗口/令牌桶实现源码解读
+ Spring Cloud Gateway 官方文档 — 过滤器链和路由机制
+ Arthas 官方文档 — 阿里巴巴开源 Java 诊断工具
+ Nacos 官方文档 — CP/AP 模式切换与 Distro 协议
+ 小林coding — Spring 面试题（IOC/AOP/SpringMVC/SpringBoot/MyBatis/SpringCloud）

