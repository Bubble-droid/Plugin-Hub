import type { ApiError, ApiMethods, ApiSuccess } from '@grammyjs/types'

export type Integer = number
export type ChatId = Integer | string

export type ApiMethod = keyof ApiMethods<File>

export type ApiParams<M extends ApiMethod> = Parameters<ApiMethods<File>[M]>[0]

export type ApiResult<M extends ApiMethod> = ReturnType<ApiMethods<File>[M]>

export type ApiResponse<M extends ApiMethod> = ApiError | ApiSuccess<ApiResult<M>>

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never
}[keyof T]

export type PickOptionalParams<M extends ApiMethod> = Pick<ApiParams<M>, OptionalKeys<ApiParams<M>>>
