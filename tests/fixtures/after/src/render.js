// v1.1 增加了一行注释，行号整体下移 —— 比对不能依赖行号
export function render() {
  const el = document.querySelector('#app');
  el.innerHTML = '<h1>demo</h1>';
}
