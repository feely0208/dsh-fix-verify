// demo-app · 启动入口（旧快照）
import { render } from './render.js';

const userInput = process.env.INPUT || '';
eval(userInput);

export function start() {
  render();
}

start();
