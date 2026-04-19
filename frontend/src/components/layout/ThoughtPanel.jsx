/*
 * 文件作用：
 * ThoughtPanel 用 AI Elements ChainOfThought 展示后端 thinking/tool/trace 事件。
 */

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircleIcon, ClockIcon, XCircleIcon } from 'lucide-react'

function stepStatus(status) {
  if (status === 'error') {
    return 'pending'
  }
  if (status === 'done') {
    return 'complete'
  }
  return 'active'
}

function stepIcon(status) {
  if (status === 'error') {
    return XCircleIcon
  }
  if (status === 'done') {
    return CheckCircleIcon
  }
  return ClockIcon
}

export function ThoughtPanel({ isBusy, pendingApprovals, thoughtSteps, onClose }) {
  return (
    <aside
      aria-label="思考详情"
      className="hidden w-96 shrink-0 border-l bg-background lg:flex lg:flex-col"
      id="thought-panel"
    >
      <header className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="font-medium">思考与工具</h2>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1 p-4">
        {isBusy ? (
          <Reasoning defaultOpen>
            <ReasoningTrigger>
              <Shimmer>模型正在推理</Shimmer>
            </ReasoningTrigger>
            <ReasoningContent>
              SimpAgent 正在读取上下文、生成回复并等待工具事件。
            </ReasoningContent>
          </Reasoning>
        ) : null}

        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>
            {thoughtSteps.length > 0
              ? `已记录 ${thoughtSteps.length} 个步骤`
              : '暂无思考步骤'}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {thoughtSteps.length === 0 ? (
              <ChainOfThoughtStep
                description="发送消息后，这里会显示 thinking、tool、trace 和错误事件。"
                label="等待会话事件"
                status="pending"
              />
            ) : null}
            {thoughtSteps.map((step) => (
              <ChainOfThoughtStep
                description={step.text}
                icon={stepIcon(step.status)}
                key={step.id}
                label={step.title}
                status={stepStatus(step.status)}
              />
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>

        {pendingApprovals.length > 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">
            等待审批：{pendingApprovals.length} 个工具调用。
          </div>
        ) : null}
      </ScrollArea>
    </aside>
  )
}
