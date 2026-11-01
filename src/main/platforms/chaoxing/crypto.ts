/**
 * 学习通（超星）密码登录用的 AES 加密。
 *
 * 依据：cxOrz/chaoxing-signin、yuban10703/chaoxingsign、Samueli924/chaoxing 等
 * 高星项目一致使用 AES-128-CBC，key = iv = "u2oh6Vu^HWe4_AES"，PKCS7 填充，输出 base64。
 * 这是网页版登录页 submit 前的同款变换（网页端 JS 里同样硬编码）。
 */

import { createCipheriv } from 'node:crypto';

export const CHAOXING_AES_KEY = 'u2oh6Vu^HWe4_AES';

export function aesEncrypt(plain: string, key = CHAOXING_AES_KEY): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(key, 'utf8'));
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}
