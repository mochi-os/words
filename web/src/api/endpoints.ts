// Copyright © 2026 Mochi OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

const endpoints = {
  game: {
    list: '/-/list',
    new: '/-/new',
    create: '/-/create',
    validate: '/-/validate',
    detail: (gameId: string) => `/${gameId}/-/view`,
    messages: (gameId: string) => `/${gameId}/-/messages`,
    send: (gameId: string) => `/${gameId}/-/send`,
    move: (gameId: string) => `/${gameId}/-/move`,
    pass: (gameId: string) => `/${gameId}/-/pass`,
    exchange: (gameId: string) => `/${gameId}/-/exchange`,
    resign: (gameId: string) => `/${gameId}/-/resign`,
    delete: (gameId: string) => `/${gameId}/-/delete`,
  },
  auth: {
    code: '/_/code',
    verify: '/_/verify',
    identity: '/_/identity',
    logout: '/_/logout',
  },
} as const

export default endpoints
