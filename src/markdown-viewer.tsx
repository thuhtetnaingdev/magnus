import React from 'react';
import { Text, Box } from 'ink';
import { marked } from 'marked';

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  const renderMarkdown = (markdown: string) => {
    try {
      // Check if this looks like an LLM response with literal asterisks
      // Common patterns in LLM responses that aren't proper markdown:
      // - ** text ** with spaces around text
      // - **Section Headers:** with colons
      // - Multiple literal asterisk patterns throughout
      
      const hasLiteralAsteriskPatterns = 
        // Pattern 1: ** text ** with spaces
        /\*\*\s+[^*]+\s+\*\*/.test(markdown) ||
        // Pattern 2: * text * with spaces  
        /\*\s+[^*]+\s+\*/.test(markdown) ||
        // Pattern 3: **Section:** style headers
        /\*\*[A-Z][a-z]+[A-Za-z\s]*:\*\*/.test(markdown) ||
        // Pattern 4: Multiple literal asterisk occurrences
        (markdown.match(/\*\*[^*]+\*\*/g) || []).length > 2;
      
      // Check for proper markdown patterns
      const hasProperMarkdown = 
        // Proper markdown bold: **text** (no spaces, word characters)
        /\*\*\w+\*\*/.test(markdown) || 
        // Proper markdown italic: *text* (no spaces, word characters)
        /\*\w+\*/.test(markdown) ||
        // Code blocks
        /```/.test(markdown) ||
        // Headers
        /^#+\s/.test(markdown);
      
      // If it has literal asterisk patterns but no proper markdown, render as plain text
      if (hasLiteralAsteriskPatterns && !hasProperMarkdown) {
        return [<Text key="plain-text">{markdown}</Text>];
      }
      
      // Parse markdown to tokens
      const tokens = marked.lexer(markdown, { gfm: true });
      const elements: React.ReactNode[] = [];
      
      // Track the last token type to manage spacing
      let lastTokenType: string | null = null;
      
      const renderInlineTokens = (tokens: any[]): React.ReactNode[] => {
        return tokens.map((token, index) => {
          switch (token.type) {
            case 'strong':
              // Ensure we always have an array of tokens to render
              const strongContent = token.tokens && token.tokens.length > 0 
                ? renderInlineTokens(token.tokens)
                : [<Text key="text">{token.text || token.raw || ''}</Text>];
              return (
                <Text key={index} bold>
                  <>{strongContent}</>
                </Text>
              );
            case 'em':
              const emContent = token.tokens && token.tokens.length > 0 
                ? renderInlineTokens(token.tokens)
                : [<Text key="text">{token.text || token.raw || ''}</Text>];
              return (
                <Text key={index} italic>
                  <>{emContent}</>
                </Text>
              );
            case 'codespan':
              return <Text key={index} color="blueBright">{token.text}</Text>;
            case 'link':
              const linkContent = token.tokens && token.tokens.length > 0 
                ? renderInlineTokens(token.tokens)
                : [<Text key="text">{token.text || token.href}</Text>];
              return (
                <Text key={index} color="blue" underline>
                  <>{linkContent}</>
                </Text>
              );
            case 'text':
              return <Text key={index}>{token.text}</Text>;
            default:
              // For any unhandled inline types, try to render their raw content
              // Check if there are nested tokens to process
              if (token.tokens && token.tokens.length > 0) {
                return <Text key={index}><>{renderInlineTokens(token.tokens)}</></Text>;
              }
              return <Text key={index}>{token.raw || token.text || ''}</Text>;
          }
        });
      };

      tokens.forEach((token, index) => {
        // Add spacing between certain block types
        if (lastTokenType && lastTokenType !== 'space' && 
            token.type !== 'space' && 
            index > 0) {
          elements.push(<Text key={`spacing-${index}`}>{'\n'}</Text>);
        }
        
        switch (token.type) {
          case 'heading':
            const level = token.depth;
            const color = level === 1 ? 'red' : level === 2 ? 'yellow' : 'green';
            elements.push(
              <Text key={index} color={color} bold>
                <>{renderInlineTokens(token.tokens || [])}</>
              </Text>
            );
            break;
            
          case 'paragraph':
            // Ensure we always have tokens to render
            const paragraphContent = token.tokens && token.tokens.length > 0 
              ? renderInlineTokens(token.tokens)
              : [<Text key="text">{token.text || token.raw || ''}</Text>];
            elements.push(
              <Text key={index}>
                <>{paragraphContent}</>
              </Text>
            );
            break;
            
          case 'code':
            elements.push(
              <Box key={index} borderStyle="round" borderColor="gray" padding={1} marginY={1}>
                <Text color="blueBright">{token.text}</Text>
              </Box>
            );
            break;
            
          case 'blockquote':
            elements.push(
              <Box key={index} flexDirection="row" marginY={1}>
                <Box width={1} backgroundColor="gray" marginRight={1} />
                <Text color="gray">
                  <>{renderInlineTokens(token.tokens || [])}</>
                </Text>
              </Box>
            );
            break;
            
          case 'list':
            const listItems = token.items.map((item: any, itemIndex: number) => {
              // Process each list item's tokens
              const itemContent = item.tokens && item.tokens.length > 0 
                ? renderInlineTokens(item.tokens)
                : [<Text key="text">{item.text}</Text>];
              
              return (
                <Text key={`${index}-${itemIndex}`}>
                  {token.ordered ? `${itemIndex + 1}. ` : '• '}
                  <>{itemContent}</>
                </Text>
              );
            });
            elements.push(
              <Box key={index} flexDirection="column" marginLeft={2}>
                {listItems}
              </Box>
            );
            break;
            
          case 'space':
            if (lastTokenType !== 'space') {
              elements.push(<Text key={index}>{'\n'}</Text>);
            }
            break;
            
          case 'text':
            elements.push(<Text key={index}>{token.text}</Text>);
            break;
            
          default:
            // For unhandled token types, try to render their raw content
            if (token.raw) {
              elements.push(<Text key={index}>{token.raw}</Text>);
            }
            break;
        }
        
        // Update last token type
        lastTokenType = token.type;
      });
      
      return elements;
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return [<Text key="error" color="red">Error rendering markdown content</Text>];
    }
  };

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      {renderMarkdown(content)}
    </Box>
  );
};
