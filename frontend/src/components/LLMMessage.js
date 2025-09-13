import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const LLMMessage = ({ content, isStreaming = false }) => {
  return (
    <div className="llm-message">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className="claude-text">{children}</span>,
          code: ({ inline, children }) => 
            inline 
              ? <code className="claude-inline-code">{children}</code> 
              : <pre className="claude-code-block"><code>{children}</code></pre>,
          strong: ({ children }) => <strong className="claude-bold">{children}</strong>,
          em: ({ children }) => <em className="claude-italic">{children}</em>,
          ul: ({ children }) => <ul className="claude-list">{children}</ul>,
          ol: ({ children }) => <ol className="claude-list">{children}</ol>,
          li: ({ children }) => <li className="claude-list-item">{children}</li>
        }}
      >
        {content || 'No content provided'}
      </ReactMarkdown>
    </div>
  );
};

export default LLMMessage;