// Jest setup file for handling async operations and cleanup

// Set test environment
process.env.NODE_ENV = 'test';

// Increase timeout for tests that involve Docker operations
jest.setTimeout(10000);

// Mock process.exit to prevent Jest from actually exiting
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});

afterAll(() => {
  process.exit = originalExit;
});

// Suppress console.log during tests to reduce noise
const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
});

// Mock Docker operations for tests
jest.mock('../src/services/DockerService', () => {
  return jest.fn().mockImplementation(() => ({
    docker: {
      info: jest.fn().mockResolvedValue({
        Containers: 0,
        ContainersRunning: 0,
        Images: 0,
        ServerVersion: '20.10.0'
      }),
      ping: jest.fn().mockResolvedValue(true)
    },
    getVersion: jest.fn().mockReturnValue('20.10.0'),
    getContainerCount: jest.fn().mockReturnValue(0),
    cleanup: jest.fn().mockResolvedValue()
  }));
});

// Global error handler for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
