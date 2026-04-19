/*
 * 文件作用：
 * WorkspacePages 承载左侧栏除 Chat 以外的工作区页面。
 *
 * 这些页面先使用 AI Elements 组件展示静态/半静态结构，后续可以再接入真实
 * agent 配置、计划、队列、文件和 schema 数据。
 */

import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions,
  AgentOutput,
  AgentTool,
  AgentTools,
} from '@/components/ai-elements/agent'
import { Canvas } from '@/components/ai-elements/canvas'
import {
  Commit,
  CommitContent,
  CommitFile,
  CommitFilePath,
  CommitFiles,
  CommitHeader,
  CommitHash,
  CommitMessage,
} from '@/components/ai-elements/commit'
import { Controls } from '@/components/ai-elements/controls'
import { Edge } from '@/components/ai-elements/edge'
import {
  EnvironmentVariable,
  EnvironmentVariableName,
  EnvironmentVariableRequired,
  EnvironmentVariables,
  EnvironmentVariablesContent,
  EnvironmentVariablesHeader,
  EnvironmentVariablesTitle,
  EnvironmentVariableValue,
} from '@/components/ai-elements/environment-variables'
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  FileTreeName,
} from '@/components/ai-elements/file-tree'
import { JSXPreview, JSXPreviewContent } from '@/components/ai-elements/jsx-preview'
import {
  Node as WorkflowNode,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node'
import {
  PackageInfo,
  PackageInfoContent,
  PackageInfoDependency,
  PackageInfoDependencies,
  PackageInfoDescription,
  PackageInfoHeader,
  PackageInfoName,
  PackageInfoVersion,
} from '@/components/ai-elements/package-info'
import {
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
} from '@/components/ai-elements/plan'
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueList,
} from '@/components/ai-elements/queue'
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabContent,
  SandboxTabs,
  SandboxTabsList,
  SandboxTabsTrigger,
} from '@/components/ai-elements/sandbox'
import {
  SchemaDisplay,
  SchemaDisplayContent,
  SchemaDisplayDescription,
  SchemaDisplayHeader,
  SchemaDisplayMethod,
  SchemaDisplayPath,
} from '@/components/ai-elements/schema-display'
import {
  StackTrace,
  StackTraceContent,
  StackTraceError,
  StackTraceErrorMessage,
  StackTraceErrorType,
  StackTraceFrames,
  StackTraceHeader,
} from '@/components/ai-elements/stack-trace'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { Terminal } from '@/components/ai-elements/terminal'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Textarea } from '@/components/ui/textarea'
import { Background, ReactFlowProvider } from '@xyflow/react'

function PageFrame({ title, description, children }) {
  return (
    <section className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger aria-label="打开或收起侧栏" />
        <div>
          <h1 className="font-medium">{title}</h1>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
          {children}
        </div>
      </ScrollArea>
    </section>
  )
}

function AgentSettingsPage() {
  const mockTool = {
    description: '读取工作区文件内容。',
    inputSchema: {
      properties: {
        path: { description: '文件路径', type: 'string' },
      },
      required: ['path'],
      type: 'object',
    },
  }

  return (
    <PageFrame description="编辑 agent 指令和工具说明。" title="Agent 设置">
      <Agent>
        <AgentHeader name="SimpAgent" />
        <AgentContent>
          <AgentInstructions>
            <Textarea
              aria-label="Agent 系统指令"
              defaultValue="你是 SimpAgent 的本地开发助手，负责解释、修改、测试并提交代码。"
              rows={8}
            />
          </AgentInstructions>
          <AgentTools type="single">
            <AgentTool tool={mockTool} value="read_file" />
          </AgentTools>
          <AgentOutput type="text">
            设置页当前只保存前端编辑态，后续接入后端配置 API。
          </AgentOutput>
        </AgentContent>
      </Agent>
    </PageFrame>
  )
}

function GraphPage() {
  const nodes = [
    {
      id: 'user',
      position: { x: 0, y: 80 },
      data: { label: '用户输入' },
      type: 'workflow',
    },
    {
      id: 'agent',
      position: { x: 280, y: 80 },
      data: { label: 'Agent Loop' },
      type: 'workflow',
    },
    {
      id: 'tool',
      position: { x: 560, y: 80 },
      data: { label: '工具审批' },
      type: 'workflow',
    },
  ]
  const edges = [
    { id: 'e-user-agent', source: 'user', target: 'agent', type: 'animated' },
    { id: 'e-agent-tool', source: 'agent', target: 'tool', type: 'animated' },
  ]
  const nodeTypes = {
    workflow: ({ data }) => (
      <WorkflowNode handles={{ source: true, target: true }}>
        <NodeHeader>
          <NodeTitle>{data.label}</NodeTitle>
          <NodeDescription>SimpAgent 节点</NodeDescription>
        </NodeHeader>
        <NodeContent>
          <Badge variant="secondary">可编排</Badge>
        </NodeContent>
      </WorkflowNode>
    ),
  }
  const edgeTypes = {
    animated: Edge.Animated,
  }

  return (
    <PageFrame description="静态工作流视图，后续可接入真实 agent 编排。" title="Graph">
      <Card className="h-[620px] overflow-hidden p-0">
        <ReactFlowProvider>
          <Canvas edgeTypes={edgeTypes} edges={edges} nodeTypes={nodeTypes} nodes={nodes}>
            <Background />
            <Controls />
          </Canvas>
        </ReactFlowProvider>
      </Card>
    </PageFrame>
  )
}

function PlansPage() {
  return (
    <PageFrame description="计划执行状态。" title="Plans">
      <Plan defaultOpen>
        <PlanHeader>
          <PlanTitle>AI Elements 前端重构</PlanTitle>
          <PlanDescription>替换旧 CSS、接入 Conversation、PromptInput 和 ChainOfThought。</PlanDescription>
        </PlanHeader>
        <PlanContent>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            <li>基础组件基线已完成。</li>
            <li>聊天主路径正在替换。</li>
            <li>最终执行浏览器和根项目回归。</li>
          </ul>
        </PlanContent>
      </Plan>
    </PageFrame>
  )
}

function QueuePage() {
  return (
    <PageFrame description="运行队列和待处理事项。" title="Queue">
      <Queue>
        <QueueList>
          <QueueItem>
            <QueueItemContent>等待工具审批</QueueItemContent>
            <QueueItemDescription>当模型请求高风险工具时会进入这里。</QueueItemDescription>
          </QueueItem>
          <QueueItem>
            <QueueItemContent>等待 SSE 结束</QueueItemContent>
            <QueueItemDescription>运行完成后会刷新 thread 快照。</QueueItemDescription>
          </QueueItem>
        </QueueList>
      </Queue>
    </PageFrame>
  )
}

function TaskPage() {
  return (
    <PageFrame description="任务步骤。" title="Task">
      <Task defaultOpen>
        <TaskTrigger title="前端重构任务" />
        <TaskContent>
          <TaskItem>替换旧消息流。</TaskItem>
          <TaskItem>替换旧输入框。</TaskItem>
          <TaskItem>替换旧思考栏。</TaskItem>
        </TaskContent>
      </Task>
    </PageFrame>
  )
}

function ToolsPage() {
  return (
    <PageFrame description="工具调用展示。" title="Tools">
      <Tool defaultOpen>
        <ToolHeader state="output-available" title="shell_command" type="tool-shell_command" />
        <ToolContent>
          <ToolInput input={{ command: 'npm.cmd --prefix frontend run build' }} />
          <ToolOutput errorText={undefined} output={{ ok: true, summary: '构建通过' }} />
        </ToolContent>
      </Tool>
      <Terminal output="> npm.cmd --prefix frontend run build\n✓ built" />
    </PageFrame>
  )
}

function CommitPage() {
  return (
    <PageFrame description="提交摘要。" title="Commit">
      <Commit defaultOpen>
        <CommitHeader>
          <CommitHash>HEAD</CommitHash>
          <CommitMessage>feat(frontend): 使用 AI Elements 重构前端</CommitMessage>
        </CommitHeader>
        <CommitContent>
          <CommitFiles>
            <CommitFile>
              <CommitFilePath>frontend/src/App.jsx</CommitFilePath>
            </CommitFile>
          </CommitFiles>
        </CommitContent>
      </Commit>
    </PageFrame>
  )
}

function EnvironmentPage() {
  return (
    <PageFrame description="环境变量说明。" title="Environment">
      <EnvironmentVariables>
        <EnvironmentVariablesHeader>
          <EnvironmentVariablesTitle>前端运行环境</EnvironmentVariablesTitle>
        </EnvironmentVariablesHeader>
        <EnvironmentVariablesContent>
          <EnvironmentVariable>
            <EnvironmentVariableName>VITE_SIMPAGENT_API_BASE</EnvironmentVariableName>
            <EnvironmentVariableValue>/api</EnvironmentVariableValue>
            <EnvironmentVariableRequired>可选</EnvironmentVariableRequired>
          </EnvironmentVariable>
        </EnvironmentVariablesContent>
      </EnvironmentVariables>
    </PageFrame>
  )
}

function FilesPage() {
  return (
    <PageFrame description="文件结构预览。" title="Files">
      <FileTree>
        <FileTreeFolder defaultOpen name="frontend/src">
          <FileTreeFolder defaultOpen name="components">
            <FileTreeFile name="layout/AppShell.jsx">
              <FileTreeName>layout/AppShell.jsx</FileTreeName>
            </FileTreeFile>
            <FileTreeFile name="components/ai-elements">
              <FileTreeName>components/ai-elements</FileTreeName>
            </FileTreeFile>
          </FileTreeFolder>
        </FileTreeFolder>
      </FileTree>
    </PageFrame>
  )
}

function PreviewPage() {
  return (
    <PageFrame description="JSX 预览。" title="Preview">
      <JSXPreview code="<Button>示例按钮</Button>">
        <JSXPreviewContent />
      </JSXPreview>
    </PageFrame>
  )
}

function PackagePage() {
  return (
    <PageFrame description="依赖信息。" title="Package">
      <PackageInfo packageName="frontend">
        <PackageInfoHeader>
          <PackageInfoName>frontend</PackageInfoName>
          <PackageInfoVersion>0.0.0</PackageInfoVersion>
        </PackageInfoHeader>
        <PackageInfoDescription>Vite React + AI Elements + shadcn/ui</PackageInfoDescription>
        <PackageInfoContent>
          <PackageInfoDependencies>
            <PackageInfoDependency name="ai" version="^6.0.168" />
            <PackageInfoDependency name="shadcn" version="^4.3.0" />
          </PackageInfoDependencies>
        </PackageInfoContent>
      </PackageInfo>
    </PageFrame>
  )
}

function SandboxPage() {
  return (
    <PageFrame description="沙箱输出。" title="Sandbox">
      <Sandbox defaultOpen>
        <SandboxHeader title="本地浏览器沙箱" />
        <SandboxContent>
          <SandboxTabs defaultValue="log">
            <SandboxTabsList>
              <SandboxTabsTrigger value="log">日志</SandboxTabsTrigger>
              <SandboxTabsTrigger value="preview">预览</SandboxTabsTrigger>
            </SandboxTabsList>
            <SandboxTabContent value="log">等待接入真实沙箱。</SandboxTabContent>
            <SandboxTabContent value="preview">
              <Input readOnly value="http://127.0.0.1:5173" />
            </SandboxTabContent>
          </SandboxTabs>
        </SandboxContent>
      </Sandbox>
    </PageFrame>
  )
}

function SchemaPage() {
  return (
    <PageFrame description="接口 schema 展示。" title="Schema">
      <SchemaDisplay method="POST" path="/threads/{threadId}/runs">
        <SchemaDisplayHeader>
          <SchemaDisplayMethod />
          <SchemaDisplayPath />
        </SchemaDisplayHeader>
        <SchemaDisplayDescription>启动一次 SimpAgent run。</SchemaDisplayDescription>
        <SchemaDisplayContent />
      </SchemaDisplay>
    </PageFrame>
  )
}

function StackPage() {
  return (
    <PageFrame description="异常栈展示。" title="Stack Trace">
      <StackTrace defaultOpen error={{ message: '示例错误', name: 'ExampleError', stack: 'ExampleError: 示例错误\n    at frontend/App.jsx:1:1' }}>
        <StackTraceHeader />
        <StackTraceContent>
          <StackTraceError>
            <StackTraceErrorType>ExampleError</StackTraceErrorType>
            <StackTraceErrorMessage>示例错误</StackTraceErrorMessage>
          </StackTraceError>
          <StackTraceFrames />
        </StackTraceContent>
      </StackTrace>
    </PageFrame>
  )
}

const PAGE_BY_WORKSPACE = {
  agent: AgentSettingsPage,
  commit: CommitPage,
  environment: EnvironmentPage,
  files: FilesPage,
  graph: GraphPage,
  package: PackagePage,
  plans: PlansPage,
  preview: PreviewPage,
  queue: QueuePage,
  sandbox: SandboxPage,
  schema: SchemaPage,
  stack: StackPage,
  task: TaskPage,
  tools: ToolsPage,
}

export function WorkspacePage({ workspaceId }) {
  const Page = PAGE_BY_WORKSPACE[workspaceId] ?? AgentSettingsPage
  return <Page />
}
