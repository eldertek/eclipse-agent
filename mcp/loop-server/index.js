#!/usr/bin/env node

/**
 * Loop MCP Server
 * 
 * This MCP provides a single tool that MUST be called whenever the agent
 * considers stopping. The tool evaluates whether stopping is truly justified
 * and either approves the stop or instructs the agent to continue.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Create server
const server = new McpServer({
    name: "loop",
    version: "1.0.0",
});

// Define the should_continue tool using the new API
server.tool(
    "should_continue",
    `CRITICAL: You MUST call this tool EVERY TIME before you consider stopping or ending your response.

This tool evaluates whether you should continue working or if stopping is justified.

When to call this tool:
- Before writing your final message
- When you think you've completed the task
- When you're unsure if there's more to do
- When you feel the urge to stop

The tool will analyze your work and either:
- APPROVE: You may stop, the task is genuinely complete
- CONTINUE: There's more work to do, keep going

Never stop without calling this tool first.`,
    {
        task_summary: z.string().describe("Brief summary of what you were asked to do"),
        work_done: z.string().describe("Detailed list of actions you have taken"),
        work_remaining: z.string().optional().describe("Honest assessment: is there anything left to do?"),
        stopping_reason: z.enum([
            "task_complete",
            "waiting_for_user",
            "error_cannot_proceed",
            "need_clarification",
            "user_requested_stop"
        ]).describe("Why you want to stop"),
        confidence: z.number().min(0).max(1).optional().describe("How confident are you that stopping is correct? (0-1)"),
        verification_done: z.boolean().optional().describe("Have you verified your changes work?")
    },
    async (args) => {
        const analysis = analyzeStoppingRequest(args);
        return {
            content: [
                {
                    type: "text",
                    text: analysis.response
                }
            ]
        };
    }
);

/**
 * Analyze whether the agent should continue or can stop
 */
function analyzeStoppingRequest(args) {
    const {
        task_summary,
        work_done,
        work_remaining,
        stopping_reason,
        confidence,
        verification_done
    } = args;

    // Always continue conditions
    const mustContinue = [];

    // Check if verification was done
    if (stopping_reason === "task_complete" && !verification_done) {
        mustContinue.push("You marked the task as complete but haven't verified your changes. Run tests or validate your work first.");
    }

    // Check confidence level
    if (confidence !== undefined && confidence < 0.8 && stopping_reason === "task_complete") {
        mustContinue.push(`Your confidence is only ${(confidence * 100).toFixed(0)}%. If you're not 80%+ confident the task is complete, there's likely more to do.`);
    }

    // Check if work_remaining is not empty when claiming complete
    if (stopping_reason === "task_complete" && work_remaining && work_remaining.trim().length > 10) {
        mustContinue.push(`You've identified remaining work: "${work_remaining}". Complete this before stopping.`);
    }

    // Check if work_done is suspiciously short
    if (work_done && work_done.split(/[.,\n]/).filter(s => s.trim()).length < 2) {
        mustContinue.push("Your work summary is very short. Have you really completed the task, or just started?");
    }

    // Legitimate stop conditions
    const canStop = [
        "waiting_for_user",
        "need_clarification",
        "user_requested_stop"
    ];

    if (canStop.includes(stopping_reason)) {
        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP

Reason: ${stopping_reason}

You may end your response. This is a legitimate stopping point because you need input from the user before proceeding.`
        };
    }

    if (stopping_reason === "error_cannot_proceed") {
        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP (with error)

You've encountered a blocking error. Make sure you've:
1. Clearly explained the error to the user
2. Suggested potential solutions or next steps
3. Asked for guidance if needed

You may end your response after providing this information.`
        };
    }

    // Task complete - check if really complete
    if (stopping_reason === "task_complete") {
        if (mustContinue.length > 0) {
            return {
                shouldContinue: true,
                response: `❌ DO NOT STOP - CONTINUE WORKING

Issues found:
${mustContinue.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Address these issues before attempting to stop again. Call this tool again when you've made progress.`
            };
        }

        // Truly complete
        return {
            shouldContinue: false,
            response: `✅ APPROVED TO STOP

Task appears genuinely complete:
- Task: ${task_summary}
- Work done: ${work_done}
- Verification: ${verification_done ? 'Yes' : 'Not specified'}
- Confidence: ${confidence !== undefined ? (confidence * 100).toFixed(0) + '%' : 'Not specified'}

You may end your response. Good work!`
        };
    }

    // Unknown reason - be cautious
    return {
        shouldContinue: true,
        response: `❌ CONTINUE WORKING

Unknown stopping reason. Please provide a valid reason:
- task_complete: The task is fully done
- waiting_for_user: You need user input
- need_clarification: The request is unclear
- error_cannot_proceed: A blocking error occurred
- user_requested_stop: User explicitly asked to stop

Continue working or call this tool with a valid reason.`
    };
}

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Loop MCP Server running");
}

main().catch(console.error);
