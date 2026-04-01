/**
 * Social Media Platform Integrations
 * Handles Instagram, LinkedIn, and other platform connections
 */

export interface SocialMediaCredentials {
  platform: 'instagram' | 'linkedin' | 'twitter' | 'facebook';
  accessToken: string;
  refreshToken?: string;
  accountId: string;
  accountName: string;
  expiresAt?: Date;
}

export interface SocialPost {
  platform: string;
  content: string;
  imageUrl?: string;
  scheduledFor?: Date;
  tags?: string[];
  location?: string;
}

export interface SocialAnalytics {
  platform: string;
  period: 'week' | 'month' | 'quarter';
  metrics: {
    posts: number;
    likes: number;
    comments: number;
    shares: number;
    reach: number;
    engagement_rate: number;
    follower_growth: number;
  };
  topPosts: Array<{
    id: string;
    content: string;
    likes: number;
    comments: number;
    engagement_rate: number;
  }>;
}

export class SocialMediaIntegrationService {
  
  // Instagram Business API Integration
  async connectInstagramBusiness(accessToken: string): Promise<SocialMediaCredentials> {
    try {
      // Verify Instagram Business account access
      const response = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Instagram connection failed: ${data.error?.message}`);
      }
      
      const businessAccount = data.data?.find((account: any) => account.instagram_business_account);
      
      if (!businessAccount) {
        throw new Error('No Instagram Business account found. Please ensure you have an Instagram Business account connected to your Facebook page.');
      }
      
      return {
        platform: 'instagram',
        accessToken,
        accountId: businessAccount.instagram_business_account.id,
        accountName: businessAccount.name,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
      };
      
    } catch (error: any) {
      console.error('Instagram connection error:', error);
      throw new Error(`Failed to connect Instagram: ${error.message}`);
    }
  }
  
  // LinkedIn API Integration
  async connectLinkedIn(accessToken: string): Promise<SocialMediaCredentials> {
    try {
      // Verify LinkedIn profile access
      const response = await fetch('https://api.linkedin.com/v2/people/~', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`LinkedIn connection failed: ${data.message}`);
      }
      
      return {
        platform: 'linkedin',
        accessToken,
        accountId: data.id,
        accountName: `${data.localizedFirstName} ${data.localizedLastName}`,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
      };
      
    } catch (error: any) {
      console.error('LinkedIn connection error:', error);
      throw new Error(`Failed to connect LinkedIn: ${error.message}`);
    }
  }
  
  // Post to Instagram
  async postToInstagram(credentials: SocialMediaCredentials, post: SocialPost): Promise<string> {
    try {
      let mediaId: string;
      
      if (post.imageUrl) {
        // Create media object with image
        const mediaResponse = await fetch(`https://graph.facebook.com/v18.0/${credentials.accountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: post.imageUrl,
            caption: post.content,
            access_token: credentials.accessToken
          })
        });
        
        const mediaData = await mediaResponse.json();
        mediaId = mediaData.id;
      } else {
        // Text-only post (Story or Reel)
        const mediaResponse = await fetch(`https://graph.facebook.com/v18.0/${credentials.accountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'STORY',
            caption: post.content,
            access_token: credentials.accessToken
          })
        });
        
        const mediaData = await mediaResponse.json();
        mediaId = mediaData.id;
      }
      
      // Publish the media
      const publishResponse = await fetch(`https://graph.facebook.com/v18.0/${credentials.accountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: mediaId,
          access_token: credentials.accessToken
        })
      });
      
      const publishData = await publishResponse.json();
      return publishData.id;
      
    } catch (error: any) {
      console.error('Instagram posting error:', error);
      throw new Error(`Failed to post to Instagram: ${error.message}`);
    }
  }
  
  // Post to LinkedIn
  async postToLinkedIn(credentials: SocialMediaCredentials, post: SocialPost): Promise<string> {
    try {
      const postData = {
        author: `urn:li:person:${credentials.accountId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: post.content
            },
            shareMediaCategory: post.imageUrl ? 'IMAGE' : 'NONE',
            ...(post.imageUrl && {
              media: [{
                status: 'READY',
                description: {
                  text: 'Shared via Naya'
                },
                media: post.imageUrl,
                title: {
                  text: 'Business Growth Content'
                }
              }]
            })
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };
      
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        body: JSON.stringify(postData)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`LinkedIn posting failed: ${data.message}`);
      }
      
      return data.id;
      
    } catch (error: any) {
      console.error('LinkedIn posting error:', error);
      throw new Error(`Failed to post to LinkedIn: ${error.message}`);
    }
  }
  
  // Twitter API Integration
  async connectTwitter(accessToken: string, accessSecret: string): Promise<SocialMediaCredentials> {
    try {
      // Twitter API v2 requires OAuth 2.0 with PKCE or OAuth 1.0a
      const response = await fetch('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Twitter connection failed: ${data.detail || data.error}`);
      }
      
      return {
        platform: 'twitter',
        accessToken,
        refreshToken: accessSecret,
        accountId: data.data.id,
        accountName: data.data.username,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year for app tokens
      };
      
    } catch (error: any) {
      console.error('Twitter connection error:', error);
      throw new Error(`Failed to connect Twitter: ${error.message}`);
    }
  }
  
  // Post to Twitter
  async postToTwitter(credentials: SocialMediaCredentials, post: SocialPost): Promise<string> {
    try {
      const postData: any = {
        text: post.content
      };
      
      // Add media if provided
      if (post.imageUrl) {
        // For Twitter, we'd need to upload media first via media upload endpoint
        // This is a simplified version - full implementation would require media upload
        console.log('Media posting to Twitter requires additional media upload step');
      }
      
      const response = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postData)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Twitter posting failed: ${data.detail || data.error}`);
      }
      
      return data.data.id;
      
    } catch (error: any) {
      console.error('Twitter posting error:', error);
      throw new Error(`Failed to post to Twitter: ${error.message}`);
    }
  }
  
  // Facebook Pages API Integration  
  async connectFacebook(accessToken: string): Promise<SocialMediaCredentials> {
    try {
      // Get user's pages
      const response = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Facebook connection failed: ${data.error?.message}`);
      }
      
      const page = data.data?.[0]; // Use first page
      
      if (!page) {
        throw new Error('No Facebook pages found. Please ensure you have a Facebook page to post to.');
      }
      
      return {
        platform: 'facebook',
        accessToken: page.access_token, // Use page token for posting
        accountId: page.id,
        accountName: page.name,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
      };
      
    } catch (error: any) {
      console.error('Facebook connection error:', error);
      throw new Error(`Failed to connect Facebook: ${error.message}`);
    }
  }
  
  // Post to Facebook
  async postToFacebook(credentials: SocialMediaCredentials, post: SocialPost): Promise<string> {
    try {
      const postData: any = {
        message: post.content,
        access_token: credentials.accessToken
      };
      
      // Add photo if provided
      if (post.imageUrl) {
        postData.link = post.imageUrl;
      }
      
      const response = await fetch(`https://graph.facebook.com/v18.0/${credentials.accountId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postData)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`Facebook posting failed: ${data.error?.message}`);
      }
      
      return data.id;
      
    } catch (error: any) {
      console.error('Facebook posting error:', error);
      throw new Error(`Failed to post to Facebook: ${error.message}`);
    }
  }
  
  // Fetch Instagram Analytics
  async getInstagramAnalytics(credentials: SocialMediaCredentials, period: 'week' | 'month' = 'week'): Promise<SocialAnalytics> {
    try {
      const since = period === 'week' ? 
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] :
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Get account insights
      const insightsResponse = await fetch(
        `https://graph.facebook.com/v18.0/${credentials.accountId}/insights?metric=impressions,reach,profile_views&period=day&since=${since}&access_token=${credentials.accessToken}`
      );
      
      const insightsData = await insightsResponse.json();
      
      // Get recent media
      const mediaResponse = await fetch(
        `https://graph.facebook.com/v18.0/${credentials.accountId}/media?fields=id,caption,like_count,comments_count,timestamp&limit=25&access_token=${credentials.accessToken}`
      );
      
      const mediaData = await mediaResponse.json();
      
      // Calculate metrics
      const totalLikes = mediaData.data?.reduce((sum: number, post: any) => sum + (post.like_count || 0), 0) || 0;
      const totalComments = mediaData.data?.reduce((sum: number, post: any) => sum + (post.comments_count || 0), 0) || 0;
      const totalPosts = mediaData.data?.length || 0;
      const avgReach = insightsData.data?.find((metric: any) => metric.name === 'reach')?.values?.reduce((sum: number, day: any) => sum + day.value, 0) / 7 || 0;
      
      return {
        platform: 'instagram',
        period,
        metrics: {
          posts: totalPosts,
          likes: totalLikes,
          comments: totalComments,
          shares: 0, // Instagram doesn't provide share metrics via API
          reach: Math.round(avgReach),
          engagement_rate: totalPosts > 0 ? ((totalLikes + totalComments) / totalPosts / avgReach * 100) : 0,
          follower_growth: 0 // Would need historical data
        },
        topPosts: mediaData.data?.slice(0, 5).map((post: any) => ({
          id: post.id,
          content: post.caption?.substring(0, 100) || '',
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
          engagement_rate: ((post.like_count + post.comments_count) / avgReach * 100) || 0
        })) || []
      };
      
    } catch (error: any) {
      console.error('Instagram analytics error:', error);
      throw new Error(`Failed to fetch Instagram analytics: ${error.message}`);
    }
  }
  
  // Fetch LinkedIn Analytics
  async getLinkedInAnalytics(credentials: SocialMediaCredentials, period: 'week' | 'month' = 'week'): Promise<SocialAnalytics> {
    try {
      // LinkedIn analytics require specific permissions and company page access
      // This is a simplified version - full implementation would need LinkedIn Company API
      
      const response = await fetch(
        `https://api.linkedin.com/v2/shares?q=owners&owners=urn:li:person:${credentials.accountId}&count=25`,
        {
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0'
          }
        }
      );
      
      const data = await response.json();
      
      return {
        platform: 'linkedin',
        period,
        metrics: {
          posts: data.elements?.length || 0,
          likes: 0, // Would need additional API calls
          comments: 0,
          shares: 0,
          reach: 0,
          engagement_rate: 0,
          follower_growth: 0
        },
        topPosts: data.elements?.slice(0, 5).map((post: any, index: number) => ({
          id: post.id || `post_${index}`,
          content: post.text?.text?.substring(0, 100) || '',
          likes: 0,
          comments: 0,
          engagement_rate: 0
        })) || []
      };
      
    } catch (error: any) {
      console.error('LinkedIn analytics error:', error);
      throw new Error(`Failed to fetch LinkedIn analytics: ${error.message}`);
    }
  }
}

export const socialMediaService = new SocialMediaIntegrationService();