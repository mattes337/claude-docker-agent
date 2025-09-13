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

  // Output is now handled via WebSocket/Claude Terminal
  // Removed getSessionOutput function as it's no longer needed

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
      
      // Note: Output is now handled via WebSocket/Claude Terminal
      // No need to fetch output separately
    }
    return result;
  }, []);

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

  const appendSessionOutput = useCallback((sessionId, output, rawOutput) => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      const session = newSessions.get(sessionId);
      
      if (session) {
        // Handle different output formats
        let outputString = '';
        if (typeof output === 'string') {
          outputString = output;
        } else if (output && typeof output === 'object') {
          // Handle output objects with data/content properties
          if (output.data !== undefined) {
            outputString = String(output.data);
          } else if (output.content !== undefined) {
            outputString = String(output.content);
          } else if (output.message !== undefined) {
            outputString = String(output.message);
          } else {
            outputString = JSON.stringify(output);
          }
        } else {
          outputString = String(output);
        }
        
        session.output = (session.output || '') + outputString;
        
        // Update raw output array for better formatting
        if (rawOutput) {
          if (!session.rawOutput) {
            session.rawOutput = [];
          }
          if (Array.isArray(session.rawOutput)) {
            session.rawOutput.push(rawOutput);
          }
        }
      } else {
        // Create session if it doesn't exist
        const outputString = typeof output === 'string' ? output : (output?.data || String(output || ''));
        newSessions.set(sessionId, {
          id: sessionId,
          output: outputString,
          rawOutput: rawOutput ? [rawOutput] : []
        });
      }
      return newSessions;
    });
  }, []);

  const replaceSessionOutput = useCallback((sessionId, output, rawOutput) => {
    setSessions(prev => {
      const newSessions = new Map(prev);
      const session = newSessions.get(sessionId);
      
      // Handle different output formats
      let outputString = '';
      if (typeof output === 'string') {
        outputString = output;
      } else if (output && typeof output === 'object') {
        // Handle output objects with data/content properties
        if (output.data !== undefined) {
          outputString = String(output.data);
        } else if (output.content !== undefined) {
          outputString = String(output.content);
        } else if (output.message !== undefined) {
          outputString = String(output.message);
        } else {
          outputString = JSON.stringify(output);
        }
      } else {
        outputString = String(output);
      }
      
      if (session) {
        // Replace the entire output instead of appending
        session.output = outputString;
        
        // Replace raw output array
        session.rawOutput = rawOutput ? [rawOutput] : [];
      } else {
        // Create session if it doesn't exist
        newSessions.set(sessionId, {
          id: sessionId,
          output: outputString,
          rawOutput: rawOutput ? [rawOutput] : []
        });
      }
      return newSessions;
    });
  }, []);

  const loadContainers = useCallback(async () => {
    const result = await apiCall('/sessions/containers');
    return result;
  }, []);

  const removeContainer = useCallback(async (containerId) => {
    const result = await apiCall(`/sessions/containers/${containerId}`, {
      method: 'DELETE'
    });
    return result;
  }, []);


  return {
    sessions,
    loadSessions,
    createSession,
    stopSession,
    clearSession,
    updateSession,
    appendSessionOutput,
    replaceSessionOutput,
    loadContainers,
    removeContainer
  };
};
