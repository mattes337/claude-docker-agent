const request = require('supertest');
const ClaudeDockerAgent = require('../src/server');

describe('Claude Docker Agent', () => {
    let app;
    let server;

    beforeAll(async () => {
        // Create app instance but don't start the server
        app = new ClaudeDockerAgent();
        server = app.app;
    });

    afterAll(async () => {
        // Cleanup if needed
        if (app && app.shutdown) {
            await app.shutdown();
        }
    });

    describe('Health Check', () => {
        test('GET /health should return healthy status', async () => {
            const response = await request(server)
                .get('/health')
                .expect(200);

            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('uptime');
        });
    });

    describe('API Endpoints', () => {
        test('GET /api/sessions should return sessions list', async () => {
            const response = await request(server)
                .get('/api/sessions')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('sessions');
            expect(Array.isArray(response.body.sessions)).toBe(true);
        });

        test('GET /api/system/config should return configuration', async () => {
            const response = await request(server)
                .get('/api/system/config')
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('config');
        });
    });

    describe('Error Handling', () => {
        test('GET /api/nonexistent should return 404', async () => {
            const response = await request(server)
                .get('/api/nonexistent')
                .expect(404);

            expect(response.body).toHaveProperty('success', false);
            expect(response.body).toHaveProperty('error');
        });

        test('POST /api/sessions with invalid data should return 400', async () => {
            const response = await request(server)
                .post('/api/sessions')
                .send({
                    name: '', // Invalid empty name
                    repoUrl: 'invalid-url'
                })
                .expect(400);

            expect(response.body).toHaveProperty('success', false);
            expect(response.body).toHaveProperty('error');
        });
    });
});
