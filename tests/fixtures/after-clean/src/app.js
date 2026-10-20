// demo-app · 启动入口（全部修完的快照）
import { render } from './render.js';

const userInput = process.env.INPUT || '';
if (userInput.length > 200) throw new Error('input too long');

export function start() {
  render();
}

start();
