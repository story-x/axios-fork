#!/usr/bin/env node

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import readline from 'readline';

const exec = promisify(execCallback);

class SetupManager {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async log(message) {
        console.log(`[设置] ${message}`);
    }

    async checkGitRemote() {
        this.log('检查 Git 远程仓库配置...');
        try {
            const remotes = await exec('git remote -v');
            console.log('当前远程仓库:');
            console.log(remotes);
            
            // 检查是否有 upstream
            if (!remotes.stdout.includes('upstream')) {
                const addUpstream = await this.question('是否要添加上游仓库 (axios/axios)? (y/n): ');
                if (addUpstream.toLowerCase() === 'y') {
                    await exec('git remote add upstream https://github.com/axios/axios.git');
                    this.log('已添加上游仓库');
                }
            }
        } catch (error) {
            this.log(`Git 检查失败: ${error.message}`);
        }
    }

    async checkNpmLogin() {
        this.log('检查 NPM 登录状态...');
        try {
            const result = await exec('npm whoami');
            this.log(`当前 NPM 用户: ${result.stdout.trim()}`);
        } catch (error) {
            this.log('未登录 NPM，请运行 "npm login" 登录');
            const login = await this.question('是否现在登录 NPM? (y/n): ');
            if (login.toLowerCase() === 'y') {
                console.log('请在新终端窗口中运行: npm login');
            }
        }
    }

    async updatePackageInfo() {
        this.log('更新 package.json 配置...');
        
        const packagePath = './package.json';
        const packageContent = await fs.readFile(packagePath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        
        console.log(`当前包名: ${packageJson.name}`);
        console.log(`当前版本: ${packageJson.version}`);
        console.log(`当前仓库: ${packageJson.repository?.url || '未设置'}`);
        
        const updateInfo = await this.question('是否要更新包信息为 fork 仓库信息? (y/n): ');
        if (updateInfo.toLowerCase() === 'y') {
            packageJson.name = 'axios-fork';
            packageJson.repository = {
                type: "git",
                url: "https://github.com/story-x/axios-fork.git"
            };
            packageJson.bugs = {
                url: "https://github.com/story-x/axios-fork/issues"
            };
            packageJson.homepage = "https://github.com/story-x/axios-fork";
            
            await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2));
            this.log('package.json 已更新');
        }
    }

    async makeScriptExecutable() {
        this.log('设置脚本执行权限...');
        try {
            // Windows 系统不需要设置执行权限
            if (process.platform === 'win32') {
                this.log('Windows 系统无需设置执行权限');
            } else {
                await exec('chmod +x sync-tags.js');
                this.log('sync-tags.js 已设置为可执行');
            }
        } catch (error) {
            this.log(`设置权限失败: ${error.message}`);
        }
    }

    async testSyncScript() {
        const test = await this.question('是否要测试同步脚本 (不发布到 NPM)? (y/n): ');
        if (test.toLowerCase() === 'y') {
            this.log('开始测试同步脚本...');
            try {
                // Windows 使用不同的环境变量语法
                const command = process.platform === 'win32' 
                    ? '$env:SKIP_NPM="true"; node sync-tags.js latest'
                    : 'SKIP_NPM=true node sync-tags.js latest';
                
                const result = await exec(command, { shell: 'powershell' });
                console.log(result);
                this.log('测试完成');
            } catch (error) {
                this.log(`测试失败: ${error.message}`);
            }
        }
    }

    async showNextSteps() {
        console.log('\n=== 设置完成 ===\n');
        console.log('下一步操作:');
        console.log('1. 配置 GitHub Secrets:');
        console.log('   - 进入仓库 Settings > Secrets and Variables > Actions');
        console.log('   - 添加 NPM_TOKEN (从 npmjs.com 获取)');
        console.log('');
        console.log('2. 手动同步测试:');
        console.log('   node sync-tags.js latest          # 同步最新版本');
        if (process.platform === 'win32') {
            console.log('   $env:SKIP_NPM="true"; node sync-tags.js latest  # 测试模式 (Windows)');
        } else {
            console.log('   SKIP_NPM=true node sync-tags.js latest  # 测试模式 (Linux/Mac)');
        }
        console.log('');
        console.log('3. 自动同步:');
        console.log('   - GitHub Actions 会每天自动检查新版本');
        console.log('   - 也可在 Actions 页面手动触发');
        console.log('');
        console.log('4. 查看发布状态:');
        console.log('   - GitHub: https://github.com/story-x/axios-fork/releases');
        console.log('   - NPM: https://www.npmjs.com/package/axios-fork');
        console.log('');
        console.log('详细说明请参考 SYNC_GUIDE.md 文件');
    }

    async run() {
        console.log('=== Axios Fork 同步环境设置 ===\n');
        
        try {
            await this.checkGitRemote();
            await this.checkNpmLogin();
            await this.updatePackageInfo();
            await this.makeScriptExecutable();
            await this.testSyncScript();
            await this.showNextSteps();
        } catch (error) {
            this.log(`设置过程中出现错误: ${error.message}`);
        } finally {
            this.rl.close();
        }
    }
}

// 运行设置
const setup = new SetupManager();
setup.run().catch(console.error); 