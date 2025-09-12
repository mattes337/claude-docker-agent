import React from 'react';
import { useLLMOutput } from '@llm-ui/react';
import { markdownLookBack } from '@llm-ui/markdown';
import { findCompleteCodeBlock, findPartialCodeBlock, codeBlockLookBack, useCodeBlockToHtml } from '@llm-ui/code';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Simple markdown component
const MarkdownComponent = ({ blockMatch }) => {
  return (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <span className="claude-text">{children}</span>,
        code: ({ inline, children }) => 
          inline ? <code className="claude-inline-code">{children}</code> : <pre className="claude-code-block"><code>{children}</code></pre>,
        strong: ({ children }) => <strong className="claude-bold">{children}</strong>,
        em: ({ children }) => <em className="claude-italic">{children}</em>,
        ul: ({ children }) => <ul className="claude-list">{children}</ul>,
        ol: ({ children }) => <ol className="claude-list">{children}</ol>,
        li: ({ children }) => <li className="claude-list-item">{children}</li>
      }}
    >
      {blockMatch.output}
    </ReactMarkdown>
  );
};

// Simple code block component
const CodeBlockComponent = ({ blockMatch }) => {
  const html = useCodeBlockToHtml({
    code: blockMatch.output,
    language: blockMatch.language || 'text',
  });

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

const LLMMessage = ({ content, isStreaming = false }) => {
  const { blockMatches } = useLLMOutput({
    llmOutput: content,
    fallbackBlock: { 
      component: MarkdownComponent,
      lookBack: markdownLookBack()
    },
    blocks: [
      {
        component: CodeBlockComponent,
        findCompleteMatch: findCompleteCodeBlock(),
        findPartialMatch: findPartialCodeBlock(),
        lookBack: codeBlockLookBack()
      }
    ],
    isStreamFinished: !isStreaming
  });

  return (
    <div className="llm-message">
      {blockMatches.map((blockMatch, index) => {
        const Component = blockMatch.block.component;
        return (
          <Component
            key={index}
            blockMatch={blockMatch}
          />
        );
      })}
    </div>
  );
};

export default LLMMessage;