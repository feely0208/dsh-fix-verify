// v1.1 用 textContent 替代 innerHTML
export function render() {
  const el = document.querySelector('#app');
  const h1 = document.createElement('h1');
  h1.textContent = 'demo';
  el.appendChild(h1);
}
