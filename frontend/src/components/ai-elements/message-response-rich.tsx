"use client";

/*
 * 文件作用：
 * 这个文件只负责“富 Markdown 消息正文”的渲染。
 *
 * 为什么从 message.tsx 拆出来：
 * - 普通消息气泡是首屏必需内容，应该保持轻量。
 * - Streamdown 的 code/math/mermaid 插件会继续引入 Shiki、KaTeX、Mermaid 等重依赖。
 * - 单独成文件后，React.lazy 可以把这些重依赖放到独立 chunk，避免阻塞聊天页初始外壳。
 */

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type RichMessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

export const RichMessageResponse = memo(
  ({ className, ...props }: RichMessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

RichMessageResponse.displayName = "RichMessageResponse";
