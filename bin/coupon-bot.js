#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");

function printHelp() {
  console.log(`
coupon-bot commands:

  coupon-bot start [--meal lunch|dinner|all] [--mess neelkesh|firstman|all]
  coupon-bot gui
  coupon-bot help

Examples:
  coupon-bot start --meal lunch --mess neelkesh
  coupon-bot start --meal dinner --mess firstman
  coupon-bot gui
`);
}

function runNodeScript(scriptPath, args = []) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

const [, , command = "help", ...rest] = process.argv;

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "start") {
  runNodeScript(path.join(__dirname, "..", "src", "index.js"), rest);
  return;
}

if (command === "gui") {
  runNodeScript(path.join(__dirname, "..", "src", "control-server.js"), rest);
  return;
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
