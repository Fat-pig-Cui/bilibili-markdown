# Markdown 公式与本地图片测试

这是一份可重复导入的测试文档。行内公式 $P(A)=\frac{a}{b}$ 应当与前后文字位于同一段。

![蓝色曲线](assets/curve.png)

下面使用带中文、空格和括号的图片文件名，并采用引用式图片语法。

![两步流程][flow]

[flow]: <assets/中文 图(1).png>

重复引用第一张图片，应复用上传结果，正文仍显示三处图片。

![再次展示曲线](./assets/curve.png)

$$
P(X=k)=\binom{n}{k}p^k(1-p)^{n-k}
$$

代码中的图片语法不应触发上传：`![不上传](missing-inline.png)`。

```markdown
![同样不上传](missing-code.png)
$code_should_stay_plain$
```
