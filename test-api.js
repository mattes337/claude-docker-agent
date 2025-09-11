const http = require('http');

// Test the health endpoint
function testHealth() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3001,
            path: '/health',
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Health check passed:', result);
                    resolve(result);
                } catch (e) {
                    console.log('❌ Health check failed - invalid JSON:', data);
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            console.log('❌ Health check failed - connection error:', e.message);
            reject(e);
        });

        req.setTimeout(5000, () => {
            console.log('❌ Health check failed - timeout');
            req.destroy();
            reject(new Error('Timeout'));
        });

        req.end();
    });
}

// Test the sessions endpoint
function testSessions() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3001,
            path: '/api/sessions',
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log('✅ Sessions API passed:', result);
                    resolve(result);
                } catch (e) {
                    console.log('❌ Sessions API failed - invalid JSON:', data);
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            console.log('❌ Sessions API failed - connection error:', e.message);
            reject(e);
        });

        req.setTimeout(5000, () => {
            console.log('❌ Sessions API failed - timeout');
            req.destroy();
            reject(new Error('Timeout'));
        });

        req.end();
    });
}

// Run tests
async function runTests() {
    console.log('🧪 Testing Claude Docker Agent API...\n');
    
    try {
        await testHealth();
        console.log('');
        await testSessions();
        console.log('\n🎉 All tests passed! The application is working correctly.');
    } catch (error) {
        console.log('\n💥 Tests failed:', error.message);
        process.exit(1);
    }
}

runTests();
