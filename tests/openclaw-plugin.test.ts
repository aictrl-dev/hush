import { describe, it, expect } from 'vitest';
import { HushSkill } from '../src/plugins/openclaw-hush.js';

describe('HushSkill (OpenClaw)', () => {
  it('exports a factory that returns tool call hooks', async () => {
    const skill = await HushSkill();
    expect(skill['before_tool_call']).toBeTypeOf('function');
    expect(skill['after_tool_call']).toBeTypeOf('function');
  });

  describe('before_tool_call (Blocking)', () => {
    it('returns block:true when read targets a sensitive file', async () => {
      const skill = await HushSkill();
      const result = await skill['before_tool_call']({ 
        toolName: 'read', 
        params: { filePath: '.env' } 
      });
      expect(result).toEqual({ block: true, blockReason: '[hush] Blocked: sensitive file' });
    });

    it('returns block:true when bash command reads a sensitive file', async () => {
      const skill = await HushSkill();
      const result = await skill['before_tool_call']({ 
        toolName: 'bash', 
        params: { command: 'cat .env' } 
      });
      expect(result).toEqual({ block: true, blockReason: '[hush] Blocked: command reads sensitive file' });
    });

    it('returns undefined for harmless read', async () => {
      const skill = await HushSkill();
      const result = await skill['before_tool_call']({ 
        toolName: 'read', 
        params: { filePath: 'package.json' } 
      });
      expect(result).toBeUndefined();
    });
  });

  describe('after_tool_call (Redaction)', () => {
    it('redacts PII from bash stdout', async () => {
      const skill = await HushSkill();
      const event = { 
        toolName: 'bash', 
        params: {}, 
        result: { stdout: 'My email is bulat@example.com' } 
      };
      
      await skill['after_tool_call'](event);
      
      expect(event.result.stdout).not.toContain('bulat@example.com');
      expect(event.result.stdout).toContain('[USER_EMAIL_');
    });

    it('redacts PII from read file content', async () => {
      const skill = await HushSkill();
      const event = {
        toolName: 'read',
        params: {},
        result: { 
          file: { content: 'Server is at 127.0.0.1 and use key sk-ant-123456789012345678901234567890123456' } 
        }
      };
      
      await skill['after_tool_call'](event);
      
      expect(event.result.file.content).not.toContain('127.0.0.1');
      expect(event.result.file.content).not.toContain('sk-ant-');
    });

    it('redacts PII from generic content field', async () => {
      const skill = await HushSkill();
      const event = {
        toolName: 'web_fetch',
        params: {},
        result: { content: 'Contact me at +1 555-010-9999' }
      };
      
      await skill['after_tool_call'](event);
      
      expect(event.result.content).not.toContain('+1 555-010-9999');
      expect(event.result.content).toContain('[PHONE_NUMBER_');
    });
  });
});
