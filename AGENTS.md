# 锤子便签Skill

这是一个全栈项目，前端使用web react vite实现，支持套壳为鸿蒙，安卓，iOS的app

后端使用Express实现

## harness架构

本项目使用harness约束编程，包含以下六个维度

### 1. 智能体编程入口

存储在项目根目录下文件：AGENTS.md

### 2. feedback测试

存储在项目根目录下文件夹：

前端：frontend/tests
后端：backend/tests

### 3. 本项目上下文

存储在项目根目录下文件夹：DOCS

### 4. 可用的工具

存储在项目根目录下文件夹：TOOLS

### 5. 固定流程的prompts（支持skill）

存储在项目根目录下文件夹：PROMPTS

比如部署到生产可用 PROMPTS/deploy-to-production.md

### 6. MEMORY

存储在项目根目录下文件夹：MEMORY

## 智能体工作流程

收到prompt后，阅读**DOCS**，生成执行任务，完成后，跑**feedback测试**，测试完成后，有价值的信息更新到**MEMORY**
