import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '__tests__[/\\\\]support[/\\\\]', '[/\\\\]\\.claude[/\\\\]worktrees[/\\\\]'],
  modulePathIgnorePatterns: ['[/\\\\]\\.claude[/\\\\]worktrees[/\\\\]'],
}

export default createJestConfig(config)
