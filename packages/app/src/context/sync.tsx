import { batch, createMemo } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()
    type ChildState = ReturnType<typeof globalSync.child>
    type ChildStore = ChildState[0]
    const child = createMemo<ChildState>(() => globalSync.child(sdk.directory))
    const store = createMemo(() => child()[0])
    const setStore = ((...args: any[]) => {
      const setter = child()[1] as (...args: any[]) => void
      return setter(...args)
    }) as SetStoreFunction<ChildStore>
    const absolute = (path: string) => (store().path.directory + "/" + path).replace("//", "/")
    const chunk = 200
    const inflight = new Map<string, Promise<void>>()
    const inflightDiff = new Map<string, Promise<void>>()
    const inflightTodo = new Map<string, Promise<void>>()
    const [meta, setMeta] = createStore({
      limit: {} as Record<string, number>,
      complete: {} as Record<string, boolean>,
      loading: {} as Record<string, boolean>,
    })

    type SetState = SetStoreFunction<ChildStore>

    const mergeMessages = (setTarget: SetState, sessionID: string, items: Message[], options?: { prune?: boolean }) => {
      const prune = options?.prune ?? false
      if (!prune) {
        if (items.length === 0) return
        setTarget(
          produce((draft) => {
            const current = draft.message[sessionID]
            if (!current) {
              draft.message[sessionID] = items.slice()
              return
            }
            for (const item of items) {
              const result = Binary.search(current, item.id, (m) => m.id)
              if (result.found) {
                current[result.index] = item
                continue
              }
              current.splice(result.index, 0, item)
            }
          }),
        )
        return
      }
      setTarget(
        produce((draft) => {
          if (items.length === 0) {
            draft.message[sessionID] = []
            return
          }
          const current = draft.message[sessionID]
          if (!current) {
            draft.message[sessionID] = items.slice()
            return
          }
          const firstResult = Binary.search(current, items[0].id, (m) => m.id)
          const lastResult = Binary.search(current, items[items.length - 1].id, (m) => m.id)
          const prefix = current.slice(0, firstResult.index)
          const tailIndex = lastResult.index + (lastResult.found ? 1 : 0)
          const suffix = current.slice(tailIndex)
          draft.message[sessionID] = [...prefix, ...items, ...suffix]
        }),
      )
    }

    const mergeParts = (setTarget: SetState, messageID: string, parts: Part[]) => {
      const sorted = parts
        .filter((p) => !!p?.id)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
      if (sorted.length === 0) return
      setTarget("part", messageID, reconcile(sorted, { key: "id" }))
    }

    const getSession = (sessionID: string) => {
      const current = store()
      const match = Binary.search(current.session, sessionID, (s) => s.id)
      if (match.found) return current.session[match.index]
      return undefined
    }

    const limitFor = (count: number) => {
      if (count <= chunk) return chunk
      return Math.ceil(count / chunk) * chunk
    }

    const hydrateMessages = (sessionID: string) => {
      if (meta.limit[sessionID] !== undefined) return

      const messages = store().message[sessionID]
      if (!messages) return

      const limit = limitFor(messages.length)
      setMeta("limit", sessionID, limit)
      setMeta("complete", sessionID, messages.length < limit)
    }

    const loadMessages = async (sessionID: string, limit: number) => {
      if (meta.loading[sessionID]) return

      setMeta("loading", sessionID, true)
      await retry(() => sdk.client.session.messages({ sessionID, limit }))
        .then((messages) => {
          const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
          const next = items
            .map((x) => x.info)
            .filter((m) => !!m?.id)
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))

          batch(() => {
            setStore("message", sessionID, reconcile(next, { key: "id" }))

            for (const message of items) {
              setStore(
                "part",
                message.info.id,
                reconcile(
                  message.parts
                    .filter((p) => !!p?.id)
                    .slice()
                    .sort((a, b) => a.id.localeCompare(b.id)),
                  { key: "id" },
                ),
              )
            }

            setMeta("limit", sessionID, limit)
            setMeta("complete", sessionID, next.length < limit)
          })
        })
        .finally(() => {
          setMeta("loading", sessionID, false)
        })
    }

    return {
      get data() {
        return store()
      },
      set: setStore,
      get status() {
        return store().status
      },
      get ready() {
        return store().status !== "loading"
      },
      get project() {
        const current = store()
        const match = Binary.search(globalSync.data.project, current.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get: getSession,
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: input.model,
          }
          const [, localSetStore] = child()
          localSetStore(
            produce((draft) => {
              const messages = draft.message[input.sessionID]
              if (!messages) {
                draft.message[input.sessionID] = [message]
              } else {
                const result = Binary.search(messages, input.messageID, (m) => m.id)
                messages.splice(result.index, 0, message)
              }
              draft.part[input.messageID] = input.parts
                .filter((p) => !!p?.id)
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
            }),
          )
        },
        mergeMessage(input: { info: Message; parts?: Part[] }) {
          const [, localSetStore] = child()
          mergeMessages(localSetStore, input.info.sessionID, [input.info])
          mergeParts(localSetStore, input.info.id, input.parts ?? [])
        },
        async sync(sessionID: string) {
          const hasSession = getSession(sessionID) !== undefined
          hydrateMessages(sessionID)

          const hasMessages = store().message[sessionID] !== undefined
          if (hasSession && hasMessages) return

          const pending = inflight.get(sessionID)
          if (pending) return pending

          const limit = meta.limit[sessionID] ?? chunk

          const sessionReq = hasSession
            ? Promise.resolve()
            : retry(() => sdk.client.session.get({ sessionID })).then((session) => {
                const data = session.data
                if (!data) return
                setStore(
                  "session",
                  produce<ChildStore["session"]>((draft) => {
                    const match = Binary.search(draft, sessionID, (s) => s.id)
                    if (match.found) {
                      draft[match.index] = data
                      return
                    }
                    draft.splice(match.index, 0, data)
                  }),
                )
              })

          const messagesReq = hasMessages ? Promise.resolve() : loadMessages(sessionID, limit)

          const promise = Promise.all([sessionReq, messagesReq])
            .then(() => {})
            .finally(() => {
              inflight.delete(sessionID)
            })

          inflight.set(sessionID, promise)
          return promise
        },
        async diff(sessionID: string) {
          if (store().session_diff[sessionID] !== undefined) return

          const pending = inflightDiff.get(sessionID)
          if (pending) return pending

          const promise = retry(() => sdk.client.session.diff({ sessionID }))
            .then((diff) => {
              setStore("session_diff", sessionID, reconcile(diff.data ?? [], { key: "file" }))
            })
            .finally(() => {
              inflightDiff.delete(sessionID)
            })

          inflightDiff.set(sessionID, promise)
          return promise
        },
        async todo(sessionID: string) {
          if (store().todo[sessionID] !== undefined) return

          const pending = inflightTodo.get(sessionID)
          if (pending) return pending

          const promise = retry(() => sdk.client.session.todo({ sessionID }))
            .then((todo) => {
              setStore("todo", sessionID, reconcile(todo.data ?? [], { key: "id" }))
            })
            .finally(() => {
              inflightTodo.delete(sessionID)
            })

          inflightTodo.set(sessionID, promise)
          return promise
        },
        history: {
          more(sessionID: string) {
            if (store().message[sessionID] === undefined) return false
            if (meta.limit[sessionID] === undefined) return false
            if (meta.complete[sessionID]) return false
            return true
          },
          loading(sessionID: string) {
            return meta.loading[sessionID] ?? false
          },
          async loadMore(sessionID: string, count = chunk) {
            if (meta.loading[sessionID]) return
            if (meta.complete[sessionID]) return

            const current = meta.limit[sessionID] ?? chunk
            await loadMessages(sessionID, current + count)
          },
        },
        fetch: async (count = 10) => {
          const [localStore, localSetStore] = child()
          const client = sdk.client
          localSetStore("limit", (x) => x + count)
          await client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .slice()
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, localStore.limit)
            localSetStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => store().session.length >= store().limit),
        archive: async (sessionID: string) => {
          const [, localSetStore] = child()
          const client = sdk.client
          await client.session.update({ sessionID, time: { archived: Date.now() } })
          localSetStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return store().path.directory
      },
    }
  },
})
