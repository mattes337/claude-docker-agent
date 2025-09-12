import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Simplified version to debug the issue
const LLMMessage = ({ content, isStreaming = false }) => {
  console.log('LLMMessage rendering with content:', content);
  
  return (
    <div className="llm-message" style={{ border: '2px solid red', padding: '8px', margin: '4px' }}>
      <div style={{ background: '#f0f0f0', padding: '4px', marginBottom: '4px', fontSize: '12px' }}>
        LLMMessage Debug: {content ? 'Content exists' : 'No content'} - Streaming: {isStreaming ? 'Yes' : 'No'}
      </div>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className="claude-text" style={{ color: 'blue' }}>{children}</span>,
          code: ({ inline, children }) => 
            inline 
              ? <code className="claude-inline-code" style={{ background: 'yellow', padding: '2px' }}>{children}</code> 
              : <pre className="claude-code-block" style={{ background: 'lightgray', padding: '8px' }}><code>{children}</code></pre>,
          strong: ({ children }) => <strong className="claude-bold" style={{ color: 'red' }}>{children}</strong>,
          em: ({ children }) => <em className="claude-italic" style={{ color: 'green' }}>{children}</em>,
          ul: ({ children }) => <ul className="claude-list" style={{ color: 'purple' }}>{children}</ul>,
          ol: ({ children }) => <ol className="claude-list" style={{ color: 'purple' }}>{children}</ol>,
          li: ({ children }) => <li className="claude-list-item">{children}</li>
        }}
      >
        {content || 'No content provided'}
      </ReactMarkdown>
    </div>
  );
};

export default LLMMessage;