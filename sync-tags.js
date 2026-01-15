#!/usr/bin/env node

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const exec = promisify(execCallback);

// 配置
const OFFICIAL_REPO = 'https://github.com/axios/axios.git';
const FORK_REPO = 'https://github.com/story-x/axios-fork.git';
const REMOTE_NAME = 'upstream';

class TagSyncManager {
    constructor() {
        this.packagePath = './package.json';
        this.currentDir = process.cwd();
    }

    async log(message) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    async execCommand(command, cwd = this.currentDir) {
        this.log(`执行命令: ${command}`);
        try {
            const { stdout, stderr } = await exec(command, { cwd });
            if (stderr && !stderr.includes('warning')) {
                this.log(`警告: ${stderr}`);
            }
            return stdout.trim();
        } catch (error) {
            this.log(`命令执行失败: ${command}`);
            this.log(`错误: ${error.message}`);
            throw error;
        }
    }

    async handleWorkingDirectory() {
        this.log('检查工作目录状态...');
        try {
            const status = await this.execCommand('git status --porcelain');
            if (status) {
                this.log('检测到未提交的更改，正在暂存...');
                // 暂存所有更改
                await this.execCommand('git stash push -m "Auto stash before sync"');
                this.log('已暂存更改');
            }
        } catch (error) {
            this.log(`处理工作目录状态失败: ${error.message}`);
            throw error;
        }
    }

    async setupRemote() {
        this.log('设置上游远程仓库...');
        try {
            // 检查是否已存在 upstream remote
            await this.execCommand(`git remote get-url ${REMOTE_NAME}`);
            this.log('上游远程仓库已存在');
        } catch (error) {
            // 如果不存在，则添加
            await this.execCommand(`git remote add ${REMOTE_NAME} ${OFFICIAL_REPO}`);
            this.log('已添加上游远程仓库');
        }
    }

    async fetchUpstream() {
        this.log('从上游仓库获取最新数据...');
        await this.execCommand(`git fetch ${REMOTE_NAME} --tags`);
    }

    async getLatestTag() {
        this.log('获取最新版本标签...');
        const tags = await this.execCommand('git tag -l "v*" --sort=-v:refname');
        const latestTag = tags.split('\n')[0];
        this.log(`最新标签: ${latestTag}`);
        return latestTag;
    }

    async getCurrentVersion() {
        const packageContent = await fs.readFile(this.packagePath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        return packageJson.version;
    }

    async updatePackageJson(newVersion, tagName) {
        this.log(`更新 package.json 版本到 ${newVersion}...`);
        
        const packageContent = await fs.readFile(this.packagePath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        
        // 更新版本
        packageJson.version = newVersion;
        
        // 更新仓库信息为 fork 仓库
        packageJson.repository = {
            type: "git",
            url: FORK_REPO
        };
        
        // 更新 bugs URL
        packageJson.bugs = {
            url: "https://github.com/story-x/axios-fork/issues"
        };
        
        // 更新 homepage
        packageJson.homepage = "https://github.com/story-x/axios-fork";
        
        // 保持现有的包名
        packageJson.name = 'axios-fork';
        
        // 移除可能导致 NPM 发布失败的钩子
        if (packageJson.scripts && packageJson.scripts.postpublish) {
            delete packageJson.scripts.postpublish;
        }

        await fs.writeFile(this.packagePath, JSON.stringify(packageJson, null, 2));
        this.log('package.json 已更新');
    }

    async updateVersionInLib(newVersion) {
        this.log('更新 lib/env/data.js 中的版本...');
        const versionFilePath = './lib/env/data.js';
        const content = `export const VERSION = "${newVersion}";\n`;
        await fs.writeFile(versionFilePath, content);
        this.log('lib/env/data.js 已更新');
    }

    async checkTagExists(tagName) {
        try {
            await this.execCommand(`git rev-parse ${tagName}`);
            return true;
        } catch (error) {
            return false;
        }
    }

    async createTag(tagName) {
        this.log(`创建标签 ${tagName}...`);
        
        // 检查标签是否已存在
        if (await this.checkTagExists(tagName)) {
            this.log(`标签 ${tagName} 已存在，跳过创建`);
            return;
        }

        await this.execCommand(`git tag ${tagName}`);
        this.log(`标签 ${tagName} 已创建`);
    }

    async pushChanges(tagName) {
        this.log('推送更改到远程仓库...');
        
        // 添加更改的文件
        await this.execCommand('git add package.json lib/env/data.js');
        
        // 检查是否有更改需要提交
        try {
            const status = await this.execCommand('git status --porcelain');
            if (status) {
                await this.execCommand(`git commit -m "chore: bump version to ${tagName}"`);
                this.log('已提交版本更新');
            } else {
                this.log('没有需要提交的更改');
            }
        } catch (error) {
            this.log('提交时出现错误，可能没有更改需要提交');
        }

        // 推送代码和标签
        await this.execCommand('git push origin HEAD');
        await this.execCommand(`git push origin ${tagName}`);
        this.log('已推送到远程仓库');
    }

    async buildProject() {
        this.log('构建项目...');
        await this.execCommand('npm ci');
        await this.execCommand('npm run build');
        this.log('项目构建完成');
    }

    async publishToNpm(tagName) {
        this.log('发布到 NPM...');
        
        const version = tagName.replace('v', '');
        const isBeta = /alpha|beta|rc/i.test(version);
        const npmTag = isBeta ? 'next' : 'latest';
        
        try {
            // axios-fork 是公开包，不需要 --access public 参数
            await this.execCommand(`npm publish --tag ${npmTag}`);
            this.log(`已发布到 NPM，标签: ${npmTag}`);
        } catch (error) {
            this.log(`NPM 发布失败: ${error.message}`);
            throw error;
        }
    }

    async syncLatestTag() {
        try {
            this.log('开始同步最新标签...');
            
            // 0. 检查并处理工作目录状态
            await this.handleWorkingDirectory();
            
            // 1. 设置上游仓库
            await this.setupRemote();
            
            // 2. 获取最新数据
            await this.fetchUpstream();
            
            // 3. 获取最新标签
            const latestTag = await this.getLatestTag();
            if (!latestTag) {
                throw new Error('未找到有效的版本标签');
            }
            
            // 4. 检查当前版本
            const currentVersion = await this.getCurrentVersion();
            const newVersion = latestTag.replace('v', '');
            
            if (currentVersion === newVersion) {
                this.log(`当前版本 ${currentVersion} 已是最新版本，无需同步`);
                return;
            }
            
            this.log(`准备从版本 ${currentVersion} 更新到 ${newVersion}`);
            
            // 5. 直接从标签创建新分支（避免 detached HEAD）
            const branchName = `sync-${latestTag}`;
            try {
                // 先删除可能存在的同名分支
                await this.execCommand(`git branch -D ${branchName}`).catch(() => {});
            } catch (e) {
                // 忽略错误，分支可能不存在
            }
            await this.execCommand(`git checkout -b ${branchName} ${latestTag}`);
            
            // 7. 更新版本信息
            await this.updatePackageJson(newVersion, latestTag);
            await this.updateVersionInLib(newVersion);
            
            // 8. 构建项目
            await this.buildProject();
            
            // 9. 创建标签并推送
            await this.createTag(latestTag);
            await this.pushChanges(latestTag);
            
            // 10. 发布到 NPM
            if (process.env.SKIP_NPM !== 'true') {
                await this.publishToNpm(latestTag);
            } else {
                this.log('跳过 NPM 发布 (SKIP_NPM=true)');
            }
            
            this.log(`成功同步版本 ${latestTag}`);
            
        } catch (error) {
            this.log(`同步失败: ${error.message}`);
            process.exit(1);
        }
    }

    async syncAllTags() {
        try {
            this.log('开始同步所有标签...');
            
            // 设置上游仓库并获取最新数据
            await this.setupRemote();
            await this.fetchUpstream();
            
            // 获取所有标签
            const allTags = await this.execCommand('git tag -l "v*" --sort=v:refname');
            const tags = allTags.split('\n').filter(tag => tag.trim());
            
            this.log(`找到 ${tags.length} 个版本标签`);
            
            for (const tag of tags) {
                if (await this.checkTagExists(tag)) {
                    this.log(`标签 ${tag} 已存在，跳过`);
                    continue;
                }
                
                this.log(`处理标签 ${tag}...`);
                const version = tag.replace('v', '');
                
                // 直接从标签创建分支（避免 detached HEAD）
                const branchName = `sync-${tag}`;
                try {
                    // 先删除可能存在的同名分支
                    await this.execCommand(`git branch -D ${branchName}`).catch(() => {});
                } catch (e) {
                    // 忽略错误，分支可能不存在
                }
                await this.execCommand(`git checkout -b ${branchName} ${tag}`);
                
                // 更新版本信息
                await this.updatePackageJson(version, tag);
                await this.updateVersionInLib(version);
                
                // 提交更改并创建标签
                await this.execCommand('git add package.json lib/env/data.js');
                await this.execCommand(`git commit -m "chore: sync version ${tag}"`);
                await this.createTag(tag);
                
                // 推送到远程
                await this.execCommand(`git push origin ${tag}`);
                
                this.log(`标签 ${tag} 同步完成`);
            }
            
            this.log('所有标签同步完成');
            
        } catch (error) {
            this.log(`批量同步失败: ${error.message}`);
            process.exit(1);
        }
    }
}

// 主程序
async function main() {
    const manager = new TagSyncManager();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'latest':
            await manager.syncLatestTag();
            break;
        case 'all':
            await manager.syncAllTags();
            break;
        default:
            console.log(`
使用方法:
  node sync-tags.js latest    # 同步最新版本
  node sync-tags.js all       # 同步所有版本标签

环境变量:
  SKIP_NPM=true              # 跳过 NPM 发布
            `);
            process.exit(1);
    }
}

// 检查是否是直接运行该脚本
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('sync-tags.js')) {
    main().catch(console.error);
} 