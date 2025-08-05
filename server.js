const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-memory storage for job tracking
const jobs = {};

// N8N webhook URLs
const N8N_WEBHOOKS = {
  login: "https://sanchit2007.app.n8n.cloud/webhook/login",
  logout: "https://sanchit2007.app.n8n.cloud/webhook/logout"
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Main attendance endpoint (handles both login and logout)
app.post("/attendance", async (req, res) => {
  try {
    const { name, department, date, time, action } = req.body;
    
    // Validation
    if (!name || !department || !date || !time || !action) {
      return res.status(400).json({ 
        error: "Missing required fields: name, department, date, time, action" 
      });
    }
    
    if (!['login', 'logout'].includes(action)) {
      return res.status(400).json({ 
        error: "Action must be either 'login' or 'logout'" 
      });
    }
    
    const jobId = uuidv4();
    jobs[jobId] = { 
      status: "processing", 
      action: action,
      name: name,
      timestamp: new Date().toISOString()
    };
    
    console.log(`Processing ${action} for ${name} (${department}) at ${date} ${time}`);
    
    // Send data to N8N webhook asynchronously
    (async () => {
      try {
        const webhookData = {
          name: name.trim(),
          department: department,
          date: date,
          time: time,
          action: action, // login or logout
          jobId: jobId,
          timestamp: new Date().toISOString()
        };
        
        console.log('Sending to N8N:', webhookData);
        
        // Choose webhook URL based on action
        const webhookUrl = N8N_WEBHOOKS[action] || N8N_WEBHOOKS.login;
        
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "User-Agent": "Employee-Tracker/1.0"
          },
          body: JSON.stringify(webhookData),
          timeout: 30000 // 30 second timeout
        });
        
        if (response.ok) {
          const n8nResponse = await response.json().catch(() => ({ status: "success" }));
          jobs[jobId].status = "success";
          jobs[jobId].n8nResponse = n8nResponse;
          console.log(`${action} successful for ${name}`);
        } else {
          throw new Error(`N8N webhook responded with status: ${response.status}`);
        }
        
      } catch (error) {
        console.error(`Error processing ${action} for ${name}:`, error.message);
        jobs[jobId].status = "failed";
        jobs[jobId].error = error.message;
      }
    })();
    
    // Immediately respond to client
    res.json({ 
      success: true,
      jobId: jobId,
      message: `${action.charAt(0).toUpperCase() + action.slice(1)} request submitted successfully`,
      action: action
    });
    
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      message: error.message 
    });
  }
});

// Legacy login endpoint (for backward compatibility)
app.post("/login", async (req, res) => {
  req.body.action = 'login';
  return app._router.handle({ ...req, method: 'POST', url: '/attendance' }, res);
});

// Legacy logout endpoint (for backward compatibility)
app.post("/logout", async (req, res) => {
  req.body.action = 'logout';
  return app._router.handle({ ...req, method: 'POST', url: '/attendance' }, res);
});

// Check job status
app.get("/status/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs[jobId];
  
  if (!job) {
    return res.status(404).json({ status: "not_found" });
  }
  
  res.json({
    status: job.status,
    action: job.action,
    name: job.name,
    timestamp: job.timestamp,
    error: job.error || null,
    n8nResponse: job.n8nResponse || null
  });
});

// Get recent activities (optional - for dashboard)
app.get("/recent-activities", (req, res) => {
  const recentJobs = Object.entries(jobs)
    .filter(([_, job]) => job.status === "success")
    .slice(-10)
    .map(([jobId, job]) => ({
      jobId,
      name: job.name,
      action: job.action,
      timestamp: job.timestamp
    }))
    .reverse();
    
  res.json(recentJobs);
});

// Cleanup old jobs (prevent memory leak)
function cleanupOldJobs() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  Object.keys(jobs).forEach(jobId => {
    const job = jobs[jobId];
    const jobTime = new Date(job.timestamp);
    
    if (jobTime < oneHourAgo) {
      delete jobs[jobId];
    }
  });
  
  console.log(`Cleanup completed. Active jobs: ${Object.keys(jobs).length}`);
}

// Run cleanup every 30 minutes
setInterval(cleanupOldJobs, 30 * 60 * 1000);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Employee Tracker Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Login Webhook: ${N8N_WEBHOOKS.login}`);
  console.log(`🔗 Logout Webhook: ${N8N_WEBHOOKS.logout}`);
  console.log(`⚡ Health Check: http://localhost:${PORT}/health`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

module.exports = app;