/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            rootDir: '.',
            roots: ['<rootDir>/tests/unit'],
            testMatch: ['**/*.test.ts'],
            transform: {
                '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
            },
        },
        {
            displayName: 'integration',
            preset: 'ts-jest',
            testEnvironment: 'node',
            rootDir: '.',
            roots: ['<rootDir>/tests/integration'],
            testMatch: ['**/*.test.ts'],
            transform: {
                '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
            },
        },
    ],
};