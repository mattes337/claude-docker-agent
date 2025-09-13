const WebSocket = require('ws');

async function testClaudeInDocker() {
    console.log('Testing Claude execution in Docker container...\n');
    
    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:3000/ws');
    
    return new Promise((resolve, reject) => {
        ws.on('open', () => {
            console.log('✅ Connected to WebSocket server');
            
            // First, create a new session
            ws.send(JSON.stringify({
                type: 'createSession',
                config: {
                    name: 'Test Claude Docker Session'
                }
            }));
        });
        
        let sessionId = null;
        let testComplete = false;
        
        ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            
            switch(message.type) {
                case 'sessionCreated':
                    sessionId = message.session.id;
                    console.log(`✅ Session created: ${sessionId}`);
                    
                    // Connect to the session
                    ws.send(JSON.stringify({
                        type: 'connect',
                        sessionId: sessionId
                    }));
                    break;
                    
                case 'sessionConnected':
                    console.log('✅ Connected to session');
                    
                    // Execute a test command that shows we're in Docker
                    console.log('\n📋 Executing test command in Docker container...');
                    ws.send(JSON.stringify({
                        type: 'executeCommand',
                        sessionId: sessionId,
                        prompt: 'Show me that you are running inside a Docker container by checking: 1) hostname, 2) current directory, 3) environment variables that indicate Docker'
                    }));
                    break;
                    
                case 'claudeMessage':
                    console.log('\n📨 Claude Response:');
                    console.log(message.message);
                    break;
                    
                case 'claudeComplete':
                    if (!testComplete) {
                        testComplete = true;
                        console.log('\n✅ Claude command completed successfully');
                        console.log('📊 Statistics:', message.statistics);
                        
                        // Clean up - stop the session
                        ws.send(JSON.stringify({
                            type: 'stopSession',
                            sessionId: sessionId,
                            force: true
                        }));
                    }
                    break;
                    
                case 'sessionStopped':
                    console.log('\n✅ Session stopped and cleaned up');
                    ws.close();
                    resolve();
                    break;
                    
                case 'error':
                    console.error('\n❌ Error:', message.error);
                    ws.close();
                    reject(new Error(message.error));
                    break;
            }
        });
        
        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            reject(error);
        });
        
        ws.on('close', () => {
            console.log('\n🔌 WebSocket connection closed');
            if (!testComplete) {
                reject(new Error('Connection closed before test completed'));
            }
        });
    });
}

// Run the test
testClaudeInDocker()
    .then(() => {
        console.log('\n✅ Test completed successfully! Claude is running inside Docker containers.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    });