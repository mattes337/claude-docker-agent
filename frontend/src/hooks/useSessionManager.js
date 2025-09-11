import { useState, useCallback } from 'react';

export const useSessionManager = () => {
  const [sessions, setSessions] = useState(new Map());

  const apiCall = async (endpoint, options = {}) => {
    try {
      const response = await fetch(`/api${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      return data;
    } catch (error) {
      console.error(`API call failed for ${endpoint}:`, error);
      return { success: false, error: error.message };
    }
  };

  const getSessionOutput = useCallback(async (sessionId) => {
    const result = await apiCall(`/sessions/${sessionId}/output`);
    
    if (result.success) {
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          // Handle both array and string formats
          if (Array.isArray(result.output)) {
            session.output = result.output.map(item => item.data || item).join('');
            session.rawOutput = result.output; // Keep raw array for type information
          } else {
            session.output = result.output || '';
          }
        }
        return newSessions;
      });
    }

    return result;
  }, []);

  const loadSessions = useCallback(async () => {
    const result = await apiCall('/sessions');
    if (result.success) {
      const sessionMap = new Map();
      result.sessions.forEach(session => {
        sessionMap.set(session.id, {
          ...session,
          output: session.output || ''
        });
      });
      setSessions(sessionMap);
      
      // Load full output for each session
      result.sessions.forEach(async (session) => {
        await getSessionOutput(session.id);
      });
    }
    return result;
  }, [getSessionOutput]);

  const createSession = useCallback(async (sessionData) => {
    const result = await apiCall('/sessions', {
      method: 'POST',
      body: JSON.stringify(sessionData)
    });

    if (result.success && result.session) {
      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.set(result.session.id, {
          ...result.session,
          output: ''
        });
        return newSessions;
      });
    }

    return result;
  }, []);

  const stopSession = useCallback(async (sessionId) => {
    const result = await apiCall(`/sessions/${sessionId}/stop`, {
      method: 'POST'
    });

    if (result.success) {
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          session.status = 'stopped';
          session.state = 'stopped';
        }
        return newSessions;
      });
    }

    return result;
  }, []);

  const executeCommand = useCallback(async (sessionId, prompt) => {
    const result = await apiCall(`/sessions/${sessionId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ prompt })
    });

    if (result.success) {
      // Add the command to the output immediately for better UX
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          session.output = (session.output || '') + `$ ${prompt}\n`;
        }
        return newSessions;
      });
    }

    return result;
  }, []);

  const clearSession = useCallback(async (sessionId) => {
    // This is a client-side operation to clear the output display
    setSessions(prev => {
      const newSessions = new Map(prev);
      const session = newSessions.get(sessionId);
      if (session) {
        session.output = '';
      }
      return newSessions;
    });

    return { success: true };
  }, []);

  const updateSession = useCallback((sessionId, updates) => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      const session = newSessions.get(sessionId);
      if (session) {
        Object.assign(session, updates);
      } else if (updates && Object.keys(updates).length > 0) {
        // Create session if it doesn't exist and we have updates
        newSessions.set(sessionId, {
          id: sessionId,
          output: '',
          ...updates
        });
      }
      return newSessions;
    });
  }, []);

  const appendSessionOutput = useCallback((sessionId, output) => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      const session = newSessions.get(sessionId);
      if (session) {
        session.output = (session.output || '') + output;
      } else {
        // Create session if it doesn't exist
        newSessions.set(sessionId, {
          id: sessionId,
          output: output || ''
        });
      }
      return newSessions;
    });
  }, []);

  return {
    sessions,
    loadSessions,
    createSession,
    stopSession,
    executeCommand,
    clearSession,
    getSessionOutput,
    updateSession,
    appendSessionOutput
  };
};
