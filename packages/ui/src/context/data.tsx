import type { Message, Session, Part, FileDiff, SessionStatus, PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

type AskUserRequest = {
  id: string
  callID: string
}

type PlanModeRequest = {
  id: string
  callID: string
}

type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  askuser?: {
    [sessionID: string]: AskUserRequest[]
  }
  planmode?: {
    [sessionID: string]: PlanModeRequest[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type PermissionRespondFn = (input: {
  sessionID: string
  permissionID: string
  response: "once" | "always" | "reject"
}) => void

export type NavigateToSessionFn = (sessionID: string) => void

export type AskUserRespondFn = (input: { requestID: string; answers: Record<string, string> }) => Promise<unknown>

export type PlanModeRespondFn = (input: { requestID: string; approved: boolean }) => Promise<unknown>

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onPermissionRespond?: PermissionRespondFn
    onNavigateToSession?: NavigateToSessionFn
    onAskUserRespond?: AskUserRespondFn
    onPlanModeRespond?: PlanModeRespondFn
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      respondToPermission: props.onPermissionRespond,
      navigateToSession: props.onNavigateToSession,
      respondToAskUser: props.onAskUserRespond,
      respondToPlanMode: props.onPlanModeRespond,
    }
  },
})
