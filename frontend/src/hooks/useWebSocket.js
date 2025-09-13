import { useEffect, useState, useRef } from 'react';

export const useWebSocket = (sessions, activeSessionId, updateSession, appendSessionOutput, replaceSessionOutput) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = () => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        reconnectAttempts.current = 0;
        
        // Subscribe to active session if exists
        if (activeSessionId) {
          wsRef.current.send(JSON.stringify({
            type: 'subscribe',
            sessionId: activeSessionId
          }));
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data, updateSession, appendSessionOutput, replaceSessionOutput);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        
        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < 5) {
          const delay = Math.pow(2, reconnectAttempts.current) * 1000;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setIsConnected(false);
    }
  };

  const handleWebSocketMessage = (data, updateSession, appendSessionOutput, replaceSessionOutput) => {
    switch (data.type) {
      case 'session_created':
        console.log('Session created:', data.session);
        break;
      
      case 'session_ready':
        console.log('Session ready:', data.sessionId);
        updateSession(data.sessionId, { status: 'running', state: 'ready' });
        break;
      
      
      case 'session_stopped':
        console.log('Session stopped:', data.sessionId);
        updateSession(data.sessionId, { status: 'stopped', state: 'stopped' });
        break;
      
      case 'resume_scheduled':
        console.log('Resume scheduled for session:', data.sessionId);
        updateSession(data.sessionId, { state: 'waiting_for_resume' });
        break;
      
      case 'session_info':
        console.log('Session info received:', data);
        if (data.session) {
          updateSession(data.session.id, data.session);
        }
        break;
      
      
      case 'usage_update':
        if (data.sessionId && data.usage) {
          updateSession(data.sessionId, { 
            usage: data.usage,
            lastUsageUpdate: new Date().toISOString()
          });
        }
        break;
        
      case 'cost_update':
        if (data.sessionId && typeof data.totalCost === 'number') {
          updateSession(data.sessionId, { 
            totalCost: data.totalCost,
            lastCostUpdate: new Date().toISOString()
          });
        }
        break;
        
      case 'message_metadata':
        if (data.sessionId && data.metadata) {
          updateSession(data.sessionId, { 
            messageMetadata: data.metadata,
            lastMetadataUpdate: new Date().toISOString()
          });
        }
        break;
      
      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Subscribe to active session changes
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activeSessionId) {
      wsRef.current.send(JSON.stringify({
        type: 'subscribe',
        sessionId: activeSessionId
      }));
    }
  }, [activeSessionId]);

  const sendMessage = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  return { isConnected, sendMessage };
};
