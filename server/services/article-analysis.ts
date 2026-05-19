import type { BrandDna } from '@shared/schema';
import { callClaude, CLAUDE_MODELS } from "./claude";

interface ArticleAnalysisResult {
  keyPoints: string[];
  insights: string;
  actionItems: string[];
  relevanceScore: number;
  readingTime?: number;
}

interface ArticleData {
  title: string;
  url: string;
  description?: string;
  author?: string;
  source?: string;
}

export class ArticleAnalysisService {
  /**
   * Analyze an article using AI based on user's Brand DNA
   */
  async analyzeArticle(articleData: ArticleData, brandDna: BrandDna): Promise<ArticleAnalysisResult> {
    try {
      // Estimate reading time based on title and description
      const wordCount = this.estimateWordCount(articleData.title, articleData.description || '');
      const readingTime = Math.max(1, Math.ceil(wordCount / 200)); // Average 200 words per minute

      const analysisPrompt = this.buildAnalysisPrompt(articleData, brandDna);
      
      const raw = await callClaude({
        model: CLAUDE_MODELS.fast,
        messages: [
          {
            role: "system",
            content: "You are a business strategist who analyzes articles for strategic insights and actionable advice. Always respond with valid JSON only."
          },
          {
            role: "user",
            content: analysisPrompt,
          },
        ],
        max_tokens: 1500,
      });

      const result = JSON.parse(raw || "{}");
      return this.parseAnalysisResponse(result, readingTime);
    } catch (error) {
      console.error('Article analysis failed:', error);
      
      // Return basic analysis as fallback
      return {
        keyPoints: ['Analysis temporarily unavailable'],
        insights: 'AI analysis could not be completed at this time.',
        actionItems: ['Save article for manual review'],
        relevanceScore: 5, // Neutral score
        readingTime: Math.max(1, Math.ceil(this.estimateWordCount(articleData.title, articleData.description || '') / 200)),
      };
    }
  }

  private buildAnalysisPrompt(articleData: ArticleData, brandDna: BrandDna): string {
    return `Analyze this article for business insights and strategic value:

ARTICLE DETAILS:
Title: ${articleData.title}
${articleData.description ? `Description: ${articleData.description}` : ''}
${articleData.author ? `Author: ${articleData.author}` : ''}
${articleData.source ? `Source: ${articleData.source}` : ''}
URL: ${articleData.url}

BUSINESS CONTEXT:
Business Type: ${brandDna.businessType}
Target Audience: ${brandDna.targetAudience}
Core Pain Point: ${brandDna.corePainPoint}
Primary Goal: ${brandDna.primaryGoal}
Authority Level: ${brandDna.authorityLevel}
Communication Style: ${brandDna.communicationStyle}

Please provide a structured analysis in the following JSON format:
{
  "keyPoints": ["3-5 key takeaways from this article"],
  "insights": "A 2-3 sentence summary of how this article relates to the business context",
  "actionItems": ["2-4 specific actions this business could take based on the article"],
  "relevanceScore": 8
}

Rate relevance from 1-10 where:
- 1-3: Not relevant to this business
- 4-6: Somewhat relevant, general business advice
- 7-8: Highly relevant to business type/goals
- 9-10: Directly applicable to specific challenges/opportunities

Focus on actionable insights that align with the business type, target audience, and primary goals.`;
  }

  private parseAnalysisResponse(parsed: any, readingTime: number): ArticleAnalysisResult {
    return {
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : ['Analysis generated successfully'],
      insights: typeof parsed.insights === 'string' ? parsed.insights : 'Strategic insights generated',
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : ['Review and implement insights'],
      relevanceScore: typeof parsed.relevanceScore === 'number' ? parsed.relevanceScore : 7,
      readingTime: Math.max(1, Math.ceil(readingTime)),
    };
  }

  private estimateWordCount(title: string, description: string): number {
    const text = `${title} ${description}`;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Re-analyze an existing article with updated Brand DNA
   */
  async reAnalyzeArticle(articleData: ArticleData, brandDna: BrandDna): Promise<ArticleAnalysisResult> {
    return this.analyzeArticle(articleData, brandDna);
  }
}

export const articleAnalysisService = new ArticleAnalysisService();