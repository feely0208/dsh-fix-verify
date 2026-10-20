// demo-app · 启动入口（新快照）
import { render } from './render.js';

const userInput = process.env.INPUT || '';
console.log('starting with input:', userInput);

export function start() {
  render();
}

start();
