/*
 * 文件作用：
 * ChatMain 负责真实聊天主路径：顶栏、Conversation 消息流、PromptInput 输入区。
 *
 * 注意：
 * 这里不再写旧 `.thread` / `.composer` / `.message` 样式，业务 UI 直接组合
 * AI Elements 与 shadcn 组件默认样式。
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments'
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation'
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from '@/components/ai-elements/context'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import {
  BotIcon,
  BrainIcon,
  MessageSquareIcon,
  PlusIcon,
  SparklesIcon,
} from 'lucide-react'

const MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'OpenAI' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek' },
  { id: 'local-dev', name: '本地开发模型', provider: 'SimpAgent' },
]

function textOfMessage(message) {
  if (message.role === 'user') {
    return message.text ?? ''
  }

  return (message.paragraphs ?? []).join('\n\n')
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text ?? ''
  }
}

function mapToolState(status) {
  if (status === 'pending') {
    return 'approval-requested'
  }
  if (status === 'approved') {
    return 'input-available'
  }
  if (status === 'denied') {
    return 'output-denied'
  }
  if (status === 'failed') {
    return 'output-error'
  }
  return 'output-available'
}

function mapConfirmation(tool) {
  if (tool.status === 'pending') {
    return { approval: { id: tool.id }, state: 'approval-requested' }
  }
  if (tool.status === 'denied') {
    return {
      approval: { id: tool.id, approved: false, reason: '用户拒绝执行工具。' },
      state: 'approval-responded',
    }
  }
  if (tool.status === 'approved') {
    return {
      approval: { id: tool.id, approved: true, reason: '用户允许执行工具。' },
      state: 'approval-responded',
    }
  }
  return {
    approval: { id: tool.id, approved: tool.status !== 'failed' },
    state: tool.status === 'failed' ? 'output-error' : 'output-available',
  }
}

function PromptAttachmentsDisplay() {
  const attachments = usePromptInputAttachments()

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment
          data={attachment}
          key={attachment.id}
          onRemove={() => attachments.remove(attachment.id)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
}

function MessageAttachments({ attachments }) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.map((attachment) => (
        <Attachment data={attachment} key={attachment.id}>
          <AttachmentPreview />
          <AttachmentInfo showMediaType />
        </Attachment>
      ))}
    </Attachments>
  )
}

function ToolApprovalItem({ tool, onToolApproval }) {
  const toolState = mapToolState(tool.status)
  const confirmation = mapConfirmation(tool)
  const input = safeJson(tool.argumentsText)

  return (
    <div className="flex flex-col gap-2">
      <Confirmation approval={confirmation.approval} state={confirmation.state}>
        <ConfirmationTitle>
          工具审批：{tool.name}
          <Badge className="ml-2" variant="secondary">
            {tool.status}
          </Badge>
        </ConfirmationTitle>
        <ConfirmationRequest>
          <p className="text-sm text-muted-foreground">
            {tool.riskSummary || 'SimpAgent 请求执行该工具。'}
          </p>
          <ConfirmationActions>
            <ConfirmationAction
              variant="outline"
              onClick={() => onToolApproval(tool.id, 'deny')}
            >
              拒绝
            </ConfirmationAction>
            <ConfirmationAction onClick={() => onToolApproval(tool.id, 'approve')}>
              允许
            </ConfirmationAction>
          </ConfirmationActions>
        </ConfirmationRequest>
        <ConfirmationAccepted>已允许执行工具。</ConfirmationAccepted>
        <ConfirmationRejected>已拒绝执行工具。</ConfirmationRejected>
      </Confirmation>

      <Tool defaultOpen>
        <ToolHeader
          state={toolState}
          title={tool.name}
          type={`tool-${tool.name}`}
        />
        <ToolContent>
          <ToolInput input={input} />
          <ToolOutput
            errorText={tool.status === 'failed' ? '工具执行失败。' : undefined}
            output={
              tool.status === 'pending' || tool.status === 'approved'
                ? undefined
                : {
                    status: tool.status,
                    toolCallId: tool.id,
                  }
            }
          />
        </ToolContent>
      </Tool>
    </div>
  )
}

function ChatMessage({ message, isThoughtPanelOpen, onToggleThoughtPanel, onToolApproval }) {
  const text = textOfMessage(message)
  const isAssistant = message.role === 'assistant'

  return (
    <Message from={message.role}>
      <MessageContent>
        <MessageAttachments attachments={message.attachments} />
        {text ? <MessageResponse>{text}</MessageResponse> : null}
        {isAssistant && message.thought ? (
          <Button
            aria-controls="thought-panel"
            aria-expanded={String(isThoughtPanelOpen)}
            size="sm"
            type="button"
            variant="outline"
            onClick={onToggleThoughtPanel}
          >
            <BrainIcon />
            {message.thought.label}
          </Button>
        ) : null}
        {message.tools?.map((tool) => (
          <ToolApprovalItem
            key={tool.id}
            tool={tool}
            onToolApproval={onToolApproval}
          />
        ))}
      </MessageContent>
    </Message>
  )
}

function ModelPicker({ selectedModel, onModelChange }) {
  const selected = MODELS.find((model) => model.id === selectedModel) ?? MODELS[0]

  return (
    <ModelSelector>
      <ModelSelectorTrigger asChild>
        <Button aria-label="选择模型" type="button" variant="ghost">
          <SparklesIcon />
          {selected.name}
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="选择模型">
        <ModelSelectorInput placeholder="搜索模型" />
        <ModelSelectorList>
          <ModelSelectorEmpty>没有匹配模型。</ModelSelectorEmpty>
          <ModelSelectorGroup heading="可用模型">
            {MODELS.map((model) => (
              <ModelSelectorItem
                key={model.id}
                value={`${model.name} ${model.provider}`}
                onSelect={() => onModelChange(model.id)}
              >
                <BotIcon />
                <span>{model.name}</span>
                <Badge className="ml-auto" variant="secondary">
                  {model.provider}
                </Badge>
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}

function ContextUsage({ messages, selectedModel }) {
  const usedTokens = useMemo(() => {
    const charCount = messages
      .map((message) => textOfMessage(message))
      .join('\n')
      .length
    return Math.max(1, Math.ceil(charCount / 3))
  }, [messages])

  return (
    <Context maxTokens={128000} modelId={selectedModel} usedTokens={usedTokens}>
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <p className="text-sm text-muted-foreground">
            当前为前端估算值；真实 usage 接入后可替换为后端返回数据。
          </p>
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  )
}

function ChatComposer({
  composerHelp,
  isBusy,
  isWaitingForApproval,
  messages,
  runStatus,
  selectedModel,
  onComposerInput,
  onEmptySubmit,
  onSendMessage,
}) {
  const [text, setText] = useState('')
  const hasText = text.trim().length > 0
  const status = runStatus === 'running' ? 'streaming' : runStatus

  const handleSubmit = useCallback(
    (message) => {
      const nextText = message.text.trim()

      if (!nextText) {
        onEmptySubmit()
        return
      }

      onSendMessage(nextText, {
        files: message.files ?? [],
      })
      setText('')
    },
    [onEmptySubmit, onSendMessage],
  )

  return (
    <div className="border-t bg-background p-4">
      <PromptInput
        accept="image/*,video/*,.txt,.md,.json,.csv"
        multiple
        onError={(error) => {
          if (error.message) {
            onEmptySubmit()
          }
        }}
        onSubmit={handleSubmit}
      >
        <PromptInputHeader>
          <PromptAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="消息输入框"
            disabled={isBusy || isWaitingForApproval}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value)
              onComposerInput()
            }}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger tooltip={{ content: '添加附件' }} />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <ContextUsage messages={messages} selectedModel={selectedModel} />
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!hasText || isBusy || isWaitingForApproval}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
      <p
        className="mt-2 text-center text-xs text-muted-foreground"
        data-tone={composerHelp.tone}
      >
        {composerHelp.text}
      </p>
    </div>
  )
}

export function ChatMain({
  composerHelp,
  isBusy,
  isThoughtPanelOpen,
  isWaitingForApproval,
  messages,
  runStatus,
  selectedModel,
  onComposerInput,
  onEmptySubmit,
  onModelChange,
  onNewChat,
  onSendMessage,
  onToggleThoughtPanel,
  onToolApproval,
}) {
  return (
    <section className="flex min-h-svh min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger aria-label="打开或收起侧栏" />
        <Separator className="h-6" orientation="vertical" />
        <ModelPicker selectedModel={selectedModel} onModelChange={onModelChange} />
        <div className="ml-auto flex items-center gap-2">
          <Button aria-label="新聊天" size="icon" variant="ghost" onClick={onNewChat}>
            <PlusIcon />
          </Button>
        </div>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="输入第一条消息后，SimpAgent 会在这里流式回复。"
              icon={<MessageSquareIcon />}
              title="开始一个 SimpAgent 会话"
            />
          ) : (
            messages.map((message) => (
              <ChatMessage
                isThoughtPanelOpen={isThoughtPanelOpen}
                key={message.id}
                message={message}
                onToggleThoughtPanel={onToggleThoughtPanel}
                onToolApproval={onToolApproval}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <ChatComposer
        composerHelp={composerHelp}
        isBusy={isBusy}
        isWaitingForApproval={isWaitingForApproval}
        messages={messages}
        runStatus={runStatus}
        selectedModel={selectedModel}
        onComposerInput={onComposerInput}
        onEmptySubmit={onEmptySubmit}
        onSendMessage={onSendMessage}
      />
    </section>
  )
}
