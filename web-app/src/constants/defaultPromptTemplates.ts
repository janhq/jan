export const DEFAULT_PROMPT_TEMPLATES = [
  {
    name: 'Travel Planning',
    trigger: 'travel',
    description: 'Plan a complete travel itinerary with recommendations',
    template: `Act as an expert travel planner. Help me plan a trip with the following details:

Destination: {destination}
Duration: {duration}
Budget: {budget}
Interests: {interests}

Please provide:
1. Day-by-day itinerary
2. Accommodation recommendations
3. Must-visit attractions
4. Local food recommendations
5. Transportation tips
6. Budget breakdown
7. Packing suggestions

Consider local culture, weather, and best times to visit each attraction.`,
    variables: ['destination', 'duration', 'budget', 'interests'],
    category: 'Travel',
    source: 'user' as const,
  },
  {
    name: 'Code Review',
    trigger: 'review',
    description: 'Comprehensive code review with best practices',
    template: `Review the following code for:

1. Code quality and readability
2. Performance optimization opportunities
3. Security vulnerabilities
4. Best practices adherence
5. Potential bugs
6. Design patterns
7. Testing recommendations

Language: {language}
Focus areas: {focus}

Provide specific, actionable feedback with examples.`,
    variables: ['language', 'focus'],
    category: 'Development',
    source: 'user' as const,
  },
  {
    name: 'Business Strategy',
    trigger: 'strategy',
    description: 'Develop business strategy and analysis',
    template: `Act as a business strategy consultant. Analyze and provide recommendations for:

Business: {business_name}
Industry: {industry}
Challenge: {challenge}

Please provide:
1. SWOT analysis
2. Market analysis
3. Competitive positioning
4. Growth opportunities
5. Risk assessment
6. Implementation roadmap
7. Key metrics to track

Base recommendations on current market trends and best practices.`,
    variables: ['business_name', 'industry', 'challenge'],
    category: 'Business',
    source: 'user' as const,
  },
  {
    name: 'Content Writing',
    trigger: 'write',
    description: 'Create engaging content for various platforms',
    template: `Create compelling content for:

Topic: {topic}
Platform: {platform}
Target audience: {audience}
Tone: {tone}
Length: {length}

Include:
1. Attention-grabbing headline
2. Engaging introduction
3. Well-structured main content
4. Strong call-to-action
5. SEO keywords (if applicable)

Make it {tone} and tailored for {audience}.`,
    variables: ['topic', 'platform', 'audience', 'tone', 'length'],
    category: 'Writing',
    source: 'user' as const,
  },
  {
    name: 'Learning Plan',
    trigger: 'learn',
    description: 'Create structured learning path for any skill',
    template: `Create a comprehensive learning plan for:

Subject: {subject}
Current level: {level}
Time available: {time_per_week} per week
Goal: {goal}
Learning style: {learning_style}

Provide:
1. Week-by-week curriculum
2. Learning resources (books, courses, tutorials)
3. Practice projects
4. Milestones and checkpoints
5. Assessment methods
6. Time estimates for each module
7. Tips for staying motivated

Make it practical and achievable.`,
    variables: ['subject', 'level', 'time_per_week', 'goal', 'learning_style'],
    category: 'Education',
    source: 'user' as const,
  },
  {
    name: 'Debug Assistant',
    trigger: 'debug',
    description: 'Help troubleshoot and fix bugs',
    template: `Help debug the following issue:

Error message: {error}
Language/Framework: {tech}
Context: {context}

Please:
1. Explain the likely cause
2. Suggest multiple solutions
3. Provide code examples
4. Explain how to prevent this in future
5. Recommend debugging tools/techniques

Be specific and include working code snippets.`,
    variables: ['error', 'tech', 'context'],
    category: 'Development',
    source: 'user' as const,
  },
]
