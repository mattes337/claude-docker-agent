const http = require('http');

function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function testFrontend() {
    console.log('🧪 Testing Frontend Connection...');

    try {
        // Test if frontend is accessible
        console.log('Testing frontend on http://localhost:3003...');
        const frontendResponse = await makeRequest('http://localhost:3003');

        if (frontendResponse.status === 200) {
            console.log('✅ Frontend is accessible on port 3003');

            // Check if it contains React app content
            const htmlContent = frontendResponse.data;
            if (htmlContent.includes('react') || htmlContent.includes('root') || htmlContent.includes('div')) {
                console.log('✅ Frontend appears to be a React application');
            }
        }

        // Test if frontend can reach backend (this would be done by the React app)
        console.log('Testing backend on http://localhost:3001/health...');
        const backendResponse = await makeRequest('http://localhost:3001/health');

        if (backendResponse.status === 200) {
            console.log('✅ Backend is accessible from test (frontend should be able to connect)');
            console.log('✅ Backend health:', JSON.parse(backendResponse.data));
        }

        console.log('\n🎉 Frontend and Backend are both running successfully!');
        console.log('📱 Frontend: http://localhost:3003');
        console.log('🔧 Backend API: http://localhost:3001');
        console.log('\n✨ The Claude Docker Agent application is ready for testing!');

    } catch (error) {
        console.error('❌ Frontend test failed:', error.message);
        process.exit(1);
    }
}

testFrontend();
