/**
 * Email Marketing Integration Service
 * Handles newsletter creation, automation, and analytics
 */

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  content: string;
  type: 'newsletter' | 'welcome' | 'nurture' | 'promotional';
  tags: string[];
}

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  content: string;
  recipientCount: number;
  scheduledFor?: Date;
  status: 'draft' | 'scheduled' | 'sent' | 'sending';
  analytics?: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    openRate: number;
    clickRate: number;
  };
}

export interface EmailSubscriber {
  email: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
  subscribeDate: Date;
  isActive: boolean;
  source: string; // 'website', 'social', 'import', etc.
}

export class EmailMarketingService {
  
  private sendGridApiKey?: string;
  private mailchimpApiKey?: string;
  
  constructor() {
    this.sendGridApiKey = process.env.SENDGRID_API_KEY;
    this.mailchimpApiKey = process.env.MAILCHIMP_API_KEY;
  }
  
  // Generate newsletter content using Naya Intelligence
  async generateNewsletterContent(brandDna: any, recentContent: any[]): Promise<EmailTemplate> {
    try {
      // Analyze recent content performance
      const topPerformingContent = recentContent
        .sort((a, b) => (b.engagement || 0) - (a.engagement || 0))
        .slice(0, 3);
      
      // Generate strategic newsletter content
      const newsletterContent = this.createStrategicNewsletter(brandDna, topPerformingContent);
      
      return {
        id: `newsletter_${Date.now()}`,
        name: `Weekly Insights - ${new Date().toLocaleDateString()}`,
        subject: newsletterContent.subject,
        content: newsletterContent.content,
        type: 'newsletter',
        tags: ['weekly', 'insights', brandDna.businessType]
      };
      
    } catch (error) {
      console.error('Newsletter generation error:', error);
      return this.generateFallbackNewsletter(brandDna);
    }
  }
  
  private createStrategicNewsletter(brandDna: any, topContent: any[]) {
    const subject = this.generateNewsletterSubject(brandDna);
    const content = this.generateNewsletterBody(brandDna, topContent);
    
    return { subject, content };
  }
  
  private generateNewsletterSubject(brandDna: any): string {
    const subjectTemplates = [
      `Weekly ${brandDna.businessType} Insights: What's Working Now`,
      `This Week's Game-Changer for ${brandDna.targetAudience}`,
      `3 Quick Wins for ${brandDna.audienceAspiration}`,
      `What I Learned This Week (That You Can Use Today)`,
      `Weekly Roundup: ${brandDna.uniquePositioning} in Action`
    ];
    
    return subjectTemplates[Math.floor(Math.random() * subjectTemplates.length)];
  }
  
  private generateNewsletterBody(brandDna: any, topContent: any[]): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
        .header { background: #f8f9fa; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .insight { background: #f8f9fa; padding: 15px; margin: 15px 0; border-left: 4px solid #007bff; }
        .cta { background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Weekly Insights</h1>
        <p>Strategic guidance for ${brandDna.targetAudience}</p>
    </div>
    
    <div class="content">
        <p>Hi there,</p>
        
        <p>This week I've been thinking about ${brandDna.corePainPoint} and how it affects ${brandDna.targetAudience}.</p>
        
        <div class="insight">
            <h3>🎯 This Week's Key Insight</h3>
            <p>The most successful ${brandDna.targetAudience} I work with have one thing in common: they understand that ${brandDna.uniquePositioning} is the foundation of sustainable growth.</p>
        </div>
        
        ${topContent.length > 0 ? `
        <h3>📈 What's Working Right Now</h3>
        <ul>
            ${topContent.map(content => `
                <li><strong>${content.title || 'Strategic Approach'}:</strong> ${content.description || 'Proven strategy for consistent results'}</li>
            `).join('')}
        </ul>
        ` : ''}
        
        <div class="insight">
            <h3>💡 Quick Win for This Week</h3>
            <p>Focus on one area where you can implement ${brandDna.uniquePositioning}. Even small changes in this area typically yield 2-3x better results.</p>
        </div>
        
        <p>Questions? Hit reply - I read every email.</p>
        
        <a href="#" class="cta">Book a Strategy Call</a>
        
        <p>Best,<br>${brandDna.authorityLevel || 'Your Strategic Partner'}</p>
        
        <hr>
        <p style="font-size: 12px; color: #666;">
            You're receiving this because you're interested in ${brandDna.primaryGoal}. 
            <a href="#">Unsubscribe</a> | <a href="#">Update preferences</a>
        </p>
    </div>
</body>
</html>`;
  }
  
  private generateFallbackNewsletter(brandDna: any): EmailTemplate {
    return {
      id: `newsletter_fallback_${Date.now()}`,
      name: 'Weekly Business Insights',
      subject: `Weekly insights for ${brandDna.targetAudience}`,
      content: this.generateNewsletterBody(brandDna, []),
      type: 'newsletter',
      tags: ['weekly', 'fallback']
    };
  }
  
  // Send newsletter via SendGrid
  async sendNewsletter(template: EmailTemplate, subscribers: EmailSubscriber[]): Promise<EmailCampaign> {
    if (!this.sendGridApiKey) {
      throw new Error('SendGrid API key not configured. Please add SENDGRID_API_KEY to your environment variables.');
    }
    
    try {
      const campaign: EmailCampaign = {
        id: `campaign_${Date.now()}`,
        name: template.name,
        subject: template.subject,
        content: template.content,
        recipientCount: subscribers.length,
        status: 'sending'
      };
      
      // Send via SendGrid
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sendGridApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: subscribers.map(sub => ({
            to: [{ email: sub.email, name: `${sub.firstName} ${sub.lastName}`.trim() }],
            subject: template.subject
          })),
          from: {
            email: 'noreply@naya.com', // This should be your verified domain
            name: 'Naya Intelligence'
          },
          content: [
            {
              type: 'text/html',
              value: template.content
            }
          ],
          tracking_settings: {
            click_tracking: { enable: true },
            open_tracking: { enable: true }
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`SendGrid error: ${JSON.stringify(error)}`);
      }
      
      campaign.status = 'sent';
      campaign.analytics = {
        sent: subscribers.length,
        delivered: subscribers.length, // Assuming immediate delivery
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0
      };
      
      return campaign;
      
    } catch (error) {
      console.error('Newsletter sending error:', error);
      throw new Error(`Failed to send newsletter: ${error.message}`);
    }
  }
  
  // Create email automation sequence
  async createNurtureSequence(brandDna: any): Promise<EmailTemplate[]> {
    const sequence: EmailTemplate[] = [];
    
    // Welcome email
    sequence.push({
      id: `welcome_${Date.now()}`,
      name: 'Welcome Email',
      subject: `Welcome! Here's what to expect...`,
      content: this.generateWelcomeEmail(brandDna),
      type: 'welcome',
      tags: ['automation', 'welcome']
    });
    
    // Day 3: Value email
    sequence.push({
      id: `value_${Date.now()}`,
      name: 'Value Email - Day 3',
      subject: `The #1 mistake ${brandDna.targetAudience} make`,
      content: this.generateValueEmail(brandDna),
      type: 'nurture',
      tags: ['automation', 'value']
    });
    
    // Day 7: Social proof email
    sequence.push({
      id: `social_proof_${Date.now()}`,
      name: 'Social Proof Email - Day 7',
      subject: `How [Client] achieved ${brandDna.audienceAspiration}`,
      content: this.generateSocialProofEmail(brandDna),
      type: 'nurture',
      tags: ['automation', 'social-proof']
    });
    
    // Day 14: Soft pitch email
    sequence.push({
      id: `soft_pitch_${Date.now()}`,
      name: 'Soft Pitch Email - Day 14',
      subject: `Ready to take the next step?`,
      content: this.generateSoftPitchEmail(brandDna),
      type: 'promotional',
      tags: ['automation', 'conversion']
    });
    
    return sequence;
  }
  
  private generateWelcomeEmail(brandDna: any): string {
    return `
    <p>Hi there!</p>
    <p>Welcome to the community of ${brandDna.targetAudience} who are serious about ${brandDna.audienceAspiration}.</p>
    <p>Over the next few days, I'll share exactly how ${brandDna.uniquePositioning} can help you avoid the common pitfalls and accelerate your progress.</p>
    <p>First thing: reply and let me know your biggest challenge with ${brandDna.corePainPoint}. I read every email and often turn responses into content that helps everyone.</p>
    <p>Talk soon!</p>
    `;
  }
  
  private generateValueEmail(brandDna: any): string {
    return `
    <p>Hi again,</p>
    <p>I've worked with hundreds of ${brandDna.targetAudience}, and I keep seeing the same mistake over and over.</p>
    <p>They focus on everything EXCEPT ${brandDna.uniquePositioning}.</p>
    <p>Here's what actually works:</p>
    <ul>
        <li>Focus on solving ${brandDna.corePainPoint} first</li>
        <li>Build systems around ${brandDna.uniquePositioning}</li>
        <li>Measure progress toward ${brandDna.audienceAspiration}</li>
    </ul>
    <p>This approach has helped my clients achieve ${brandDna.successDefinition} consistently.</p>
    <p>Questions? Just reply to this email.</p>
    `;
  }
  
  private generateSocialProofEmail(brandDna: any): string {
    return `
    <p>Quick success story for you...</p>
    <p>Last month, one of my clients (let's call her Sarah) was struggling with ${brandDna.corePainPoint}.</p>
    <p>She was working 60-hour weeks but not seeing the results she wanted.</p>
    <p>Within 90 days of implementing ${brandDna.uniquePositioning}, she achieved ${brandDna.audienceAspiration}.</p>
    <p>The difference? She focused on the fundamentals that actually drive results, not the shiny tactics that waste time.</p>
    <p>Want similar results? Let's talk about how ${brandDna.uniquePositioning} can work for your specific situation.</p>
    `;
  }
  
  private generateSoftPitchEmail(brandDna: any): string {
    return `
    <p>Over the past two weeks, I've shared insights on:</p>
    <ul>
        <li>Avoiding the #1 mistake ${brandDna.targetAudience} make</li>
        <li>Real results from clients using ${brandDna.uniquePositioning}</li>
        <li>The fundamentals that actually drive ${brandDna.audienceAspiration}</li>
    </ul>
    <p>If you're ready to stop struggling with ${brandDna.corePainPoint} and start seeing consistent progress, I'd love to help.</p>
    <p>I have a few spots open for ${brandDna.primaryGoal} conversations this month.</p>
    <p>These are 30-minute calls where we'll map out exactly how ${brandDna.uniquePositioning} can help you achieve ${brandDna.successDefinition}.</p>
    <p>No pressure, no pitch - just strategic clarity.</p>
    <p><a href="#">Book your call here</a></p>
    `;
  }
  
  // Get email analytics
  async getEmailAnalytics(campaignId: string): Promise<EmailCampaign['analytics']> {
    if (!this.sendGridApiKey) {
      throw new Error('SendGrid API key not configured');
    }
    
    try {
      // Get campaign stats from SendGrid
      const response = await fetch(`https://api.sendgrid.com/v3/stats?start_date=${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}`, {
        headers: {
          'Authorization': `Bearer ${this.sendGridApiKey}`
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`SendGrid analytics error: ${JSON.stringify(data)}`);
      }
      
      // Process and return analytics
      const stats = data[0]?.stats?.[0] || {};
      
      return {
        sent: stats.requests || 0,
        delivered: stats.delivered || 0,
        opened: stats.unique_opens || 0,
        clicked: stats.unique_clicks || 0,
        unsubscribed: stats.unsubscribes || 0,
        openRate: stats.requests ? (stats.unique_opens / stats.requests * 100) : 0,
        clickRate: stats.delivered ? (stats.unique_clicks / stats.delivered * 100) : 0
      };
      
    } catch (error) {
      console.error('Email analytics error:', error);
      return {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0
      };
    }
  }
}

export const emailMarketingService = new EmailMarketingService();