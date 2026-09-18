# 十、编码与算法能力
> **目标岗位：阿里 P7 后端开发**  
P7 编码轮考察：手写关键数据结构（LRU/LFU）、并发编程编码（DCL/交替打印/手写线程池）、算法思维（滑动窗口/BFS）、设计模式实战。
>

---

## 题型分类
```plain
编码与算法能力
├── 数据结构设计: LRU / LFU / 手写线程池
├── 并发编程: DCL单例 / 交替打印 / 生产者-消费者
├── 算法题: 链表反转 / 层序遍历 / 滑动窗口 / 合并K链表
├── 设计模式: 观察者 / 策略+函数式接口
└── 场景编码: 令牌桶限流器
```

**P6 vs P7 编码轮差异**：P6写出基本实现，P7能解释设计决策（虚拟头尾节点、volatile指令重排、while非if防虚假唤醒）、分析时空复杂度、边界条件全覆盖。

---

### Q1：手写 LRU 缓存（Least Recently Used）
**要求**：实现 `get(key)` 和 `put(key, value)` 均为 O(1)，容量满时淘汰最久未使用。

**答案**：

```java
class LRUCache {
    class DLinkedNode {
        int key, value;
        DLinkedNode prev, next;
        DLinkedNode() {}
        DLinkedNode(int k, int v) { key = k; value = v; }
    }

    private Map<Integer, DLinkedNode> cache = new HashMap<>();
    private int capacity, size;
    private DLinkedNode head, tail;

    public LRUCache(int capacity) {
        this.capacity = capacity;
        head = new DLinkedNode();
        tail = new DLinkedNode();
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        DLinkedNode node = cache.get(key);
        if (node == null) return -1;
        moveToHead(node);
        return node.value;
    }

    public void put(int key, int value) {
        DLinkedNode node = cache.get(key);
        if (node == null) {
            DLinkedNode newNode = new DLinkedNode(key, value);
            cache.put(key, newNode);
            addToHead(newNode);
            if (++size > capacity) {
                DLinkedNode tail = removeTail();
                cache.remove(tail.key);
                --size;
            }
        } else {
            node.value = value;
            moveToHead(node);
        }
    }

    private void addToHead(DLinkedNode node) {
        node.prev = head;
        node.next = head.next;
        head.next.prev = node;
        head.next = node;
    }

    private void removeNode(DLinkedNode node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void moveToHead(DLinkedNode node) {
        removeNode(node);
        addToHead(node);
    }

    private DLinkedNode removeTail() {
        DLinkedNode res = tail.prev;
        removeNode(res);
        return res;
    }
}
```

**关键点**：双向链表 + HashMap。O(1) 删除已知节点（用 map 定位）。虚拟头尾节点简化边界。

**追问**：`LinkedHashMap` 重写 `removeEldestEntry()` 一行搞定。

---

### Q2：手写 LFU 缓存（Least Frequently Used）
**要求**：容量满时淘汰使用次数最少，平局时淘汰最久未使用。get/put 均为 O(1)。

**答案**：

```java
class LFUCache {
    class Node {
        int key, value, freq;
        Node prev, next;
        Node(int k, int v) { key = k; value = v; freq = 1; }
    }
    class DoublyLinkedList {
        Node head, tail;
        int size;
        DoublyLinkedList() {
            head = new Node(0, 0);
            tail = new Node(0, 0);
            head.next = tail;
            tail.prev = head;
        }
        void addToHead(Node node) {
            node.prev = head;
            node.next = head.next;
            head.next.prev = node;
            head.next = node;
            size++;
        }
        void remove(Node node) {
            node.prev.next = node.next;
            node.next.prev = node.prev;
            size--;
        }
        Node removeTail() {
            Node res = tail.prev;
            remove(res);
            return res;
        }
    }

    private Map<Integer, Node> cache = new HashMap<>();
    private Map<Integer, DoublyLinkedList> freqMap = new HashMap<>();
    private int capacity, minFreq;

    public LFUCache(int capacity) {
        this.capacity = capacity;
    }

    public int get(int key) {
        Node node = cache.get(key);
        if (node == null) return -1;
        updateFreq(node);
        return node.value;
    }

    public void put(int key, int value) {
        if (capacity == 0) return;
        Node node = cache.get(key);
        if (node != null) {
            node.value = value;
            updateFreq(node);
        } else {
            if (cache.size() == capacity) {
                DoublyLinkedList minList = freqMap.get(minFreq);
                Node dead = minList.removeTail();
                cache.remove(dead.key);
            }
            Node newNode = new Node(key, value);
            cache.put(key, newNode);
            freqMap.computeIfAbsent(1, k -> new DoublyLinkedList()).addToHead(newNode);
            minFreq = 1;
        }
    }

    private void updateFreq(Node node) {
        int freq = node.freq;
        DoublyLinkedList oldList = freqMap.get(freq);
        oldList.remove(node);
        if (freq == minFreq && oldList.size == 0) {
            minFreq++;
        }
        node.freq++;
        freqMap.computeIfAbsent(node.freq, k -> new DoublyLinkedList()).addToHead(node);
    }
}
```

**关键点**：`freqMap` 键为频次、值为双向链表，`minFreq` 跟踪最小频次，淘汰时从 `minFreq` 链表尾部移除（O(1) 定位淘汰目标）。

---

### Q3：线程安全的单例模式（DCL + volatile）
```java
public class Singleton {
    private static volatile Singleton instance;
    private Singleton() {}
    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

**关键点**：`volatile` 防止指令重排序（半初始化对象：new 三步 分配→初始化→赋值 可能重排，另一线程会读到半初始化对象）。双重检查减少同步开销。

**P7 追问**：枚举单例 `enum S{INSTANCE}` 天然防反射/序列化。

---

### Q4：三个线程交替打印 ABC（Lock/Condition）
**要求**：三个线程依次打印 A、B、C，循环 10 次。

**答案（Lock + Condition）**：

```java
public class PrintABC {
    private int state = 0;
    private final int times;
    private final Lock lock = new ReentrantLock();
    private final Condition condA = lock.newCondition();
    private final Condition condB = lock.newCondition();
    private final Condition condC = lock.newCondition();

    public PrintABC(int times) { this.times = times; }

    public void printA() {
        lock.lock();
        try {
            for (int i = 0; i < times; i++) {
                while (state % 3 != 0) condA.await();
                System.out.print("A");
                state++;
                condB.signal();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            lock.unlock();
        }
    }
    // printB, printC 同理：while (state % 3 != 1) condB.await() ... condC.signal()
    //                      while (state % 3 != 2) condC.await() ... condA.signal()
}
```

**补充**：Semaphore 版更简洁：semA=1, semB=0, semC=0 → acquire/release 接力。

---

### Q5：生产者-消费者模型（BlockingQueue + wait/notify）
```java
class ProducerConsumer {
    private static final BlockingQueue<Integer> queue = new LinkedBlockingQueue<>(10);
    static class Producer implements Runnable {
        public void run() {
            try {
                for (int i = 0; i < 100; i++) {
                    queue.put(i);
                    System.out.println("Produced: " + i);
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }
    static class Consumer implements Runnable {
        public void run() {
            try {
                while (true) {
                    Integer item = queue.take();
                    System.out.println("Consumed: " + item);
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }
}
```

**扩展**：手写 wait/notify 版本（阻塞队列核心逻辑）：

```java
class B {
    int[] buf; int c, in, out;
    B(int s) { buf = new int[s]; }
    synchronized void put(int v) throws Exception {
        while (c == buf.length) wait();  // while 非 if：防虚假唤醒
        buf[in] = v; in = (in + 1) % buf.length; c++;
        notifyAll();
    }
    synchronized int take() throws Exception {
        while (c == 0) wait();
        int v = buf[out]; out = (out + 1) % buf.length; c--;
        notifyAll();
        return v;
    }
}
```

---

### Q6：链表反转（迭代 + 递归）
```java
// 迭代
public ListNode reverseList(ListNode head) {
    ListNode prev = null, curr = head;
    while (curr != null) {
        ListNode next = curr.next;
        curr.next = prev;
        prev = curr;
        curr = next;
    }
    return prev;
}

// 递归
public ListNode reverseListRecursive(ListNode head) {
    if (head == null || head.next == null) return head;
    ListNode newHead = reverseListRecursive(head.next);
    head.next.next = head;
    head.next = null;
    return newHead;
}
```

---

### Q7：二叉树的层序遍历（BFS）及锯齿形遍历
```java
// 普通层序
public List<List<Integer>> levelOrder(TreeNode root) {
    List<List<Integer>> res = new ArrayList<>();
    if (root == null) return res;
    Queue<TreeNode> q = new LinkedList<>();
    q.offer(root);
    while (!q.isEmpty()) {
        int size = q.size();
        List<Integer> level = new ArrayList<>();
        for (int i = 0; i < size; i++) {
            TreeNode node = q.poll();
            level.add(node.val);
            if (node.left != null) q.offer(node.left);
            if (node.right != null) q.offer(node.right);
        }
        res.add(level);
    }
    return res;
}

// 锯齿形：用一个 flag 判断是否反转 level 列表再添加
```

**扩展**：锯齿形也可用 `LinkedList` 的 `addFirst`/`addLast` 按 flag 选择插入端，避免 `reverse` 的额外开销。

---

### Q8：滑动窗口最大值（LeetCode 239）——双端队列
```java
public int[] maxSlidingWindow(int[] nums, int k) {
    int n = nums.length;
    int[] res = new int[n - k + 1];
    Deque<Integer> deque = new ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        // 窗口左侧移除
        if (!deque.isEmpty() && deque.peekFirst() < i - k + 1) deque.pollFirst();
        // 保持递减
        while (!deque.isEmpty() && nums[deque.peekLast()] < nums[i]) deque.pollLast();
        deque.offerLast(i);
        if (i >= k - 1) res[i - k + 1] = nums[deque.peekFirst()];
    }
    return res;
}
```

**关键点**：双端队列 O(n)——每个元素入队出队各一次；队列存下标而非值，便于判断窗口边界。

---

### Q9（新增）：合并K链表（最小堆 O(N logK)）
```java
ListNode m(ListNode[] ls) {
    PriorityQueue<ListNode> pq = new PriorityQueue<>((a, b) -> a.val - b.val);
    for (ListNode n : ls) if (n != null) pq.offer(n);
    ListNode d = new ListNode(0), c = d;
    while (!pq.isEmpty()) {
        ListNode n = pq.poll();
        c.next = n;
        c = c.next;
        if (n.next != null) pq.offer(n.next);
    }
    return d.next;
}
```

**追问**：也可用两两归并（分治，O(N logK) 且无堆开销）；堆方案代码更简洁，优先队列中始终只保留 K 个节点。

---

### Q10：设计模式——观察者模式（事件通知）
```java
// 主题接口
interface Subject {
    void register(Observer o);
    void remove(Observer o);
    void notifyObservers(String msg);
}
// 观察者接口
interface Observer {
    void update(String msg);
}

class NewsAgency implements Subject {
    private List<Observer> observers = new ArrayList<>();
    public void register(Observer o) { observers.add(o); }
    public void remove(Observer o) { observers.remove(o); }
    public void notifyObservers(String msg) {
        for (Observer o : observers) o.update(msg);
    }
    public void newsArrived(String news) { notifyObservers(news); }
}
```

**使用场景**：Spring 事件监听（EventListener）、消息通知系统、ZK Watcher。

---

### Q11：策略模式结合函数式接口优化 if-else
```java
// 传统
interface DiscountStrategy {
    double apply(double price);
}
class NoDiscount implements DiscountStrategy {
    public double apply(double price) { return price; }
}
class TenPercentOff implements DiscountStrategy {
    public double apply(double price) { return price * 0.9; }
}

class PriceCalculator {
    private DiscountStrategy strategy;
    public PriceCalculator(DiscountStrategy strategy) { this.strategy = strategy; }
    public double calculate(double price) { return strategy.apply(price); }
}
// 使用
PriceCalculator calc = new PriceCalculator(new TenPercentOff());
calc.calculate(100);
```

**Java 8+ 简化**：`strategy = price -> price * 0.9;`

**更进一步**：策略注册表替代 if-else 分发：

```java
Map<String, Function<Double, Double>> m = Map.of("no", p -> p, "10%", p -> p * 0.9);
m.get(type).apply(price);
```

---

### Q12（新增）：令牌桶限流器
```java
class TB {
    long cap, last = System.nanoTime();
    double rate, tokens;
    TB(long c, double r) { cap = c; rate = r; tokens = c; }
    synchronized boolean acq() {
        long n = System.nanoTime();
        tokens = Math.min(cap, tokens + (n - last) / 1e9 * rate);
        last = n;
        if (tokens >= 1) { tokens--; return true; }
        return false;
    }
}
```

**关键点**：令牌按速率持续补充，桶容量 cap 允许一定突发流量——网关限流经典实现（对比漏桶：严格平滑但无突发能力）。

---

### Q13：手写一个简单的线程池
```java
class SimpleThreadPool {
    private final BlockingQueue<Runnable> queue = new LinkedBlockingQueue<>();
    private final List<Worker> workers = new ArrayList<>();
    private volatile boolean isShutdown = false;

    public SimpleThreadPool(int nThreads) {
        for (int i = 0; i < nThreads; i++) {
            Worker worker = new Worker();
            workers.add(worker);
            worker.start();
        }
    }

    public void execute(Runnable task) {
        if (!isShutdown) queue.offer(task);
    }

    public void shutdown() {
        isShutdown = true;
        for (Worker w : workers) w.interrupt();
    }

    private class Worker extends Thread {
        public void run() {
            while (!isShutdown || !queue.isEmpty()) {
                try {
                    Runnable task = queue.poll(1, TimeUnit.SECONDS);
                    if (task != null) task.run();
                } catch (InterruptedException e) {
                    // 退出
                    break;
                }
            }
        }
    }
}
```

**关键**：阻塞队列、中断信号、优雅关闭（shutdown 后不再接新任务，处理完队列中剩余任务）。

---

## 面试STAR
| 题目 | 话术 |
| --- | --- |
| LRU | "双向链表+HashMap O(1)，项目本地热点缓存替代Guava" |
| DCL | "volatile防重排，团队规范用枚举单例防反射" |
| 交替打印 | "Condition接力，用于顺序异步任务编排" |
| 滑动窗口 | "双端队列O(n)，监控QPS滑动窗口统计" |
| 线程池 | "理解原理后灵活定制拒绝策略和队列选型" |
| 令牌桶 | "网关限流平滑突发，比漏桶更适合互联网" |


