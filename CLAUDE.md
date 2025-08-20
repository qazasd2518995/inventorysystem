# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web scraping and data export system for Yahoo Auction and Ruten Marketplace products. The system scrapes product information from these platforms, stores it in a PostgreSQL database, and provides Excel export functionality through a web interface.

## Core Architecture

### Main Components

1. **Web Scrapers**
   - `database_scraper.js` - Yahoo Auction scraper with database integration
   - `ruten_scraper.js` - Ruten marketplace scraper with retry mechanisms
   - Both use Puppeteer for browser automation and include image success rate tracking

2. **Database Layer**
   - `database.js` - PostgreSQL operations with product upsert, comparison, and update tracking
   - Supports multi-store architecture (yuanzhengshan, youmao store types)
   - Includes automatic table upgrades and logging system

3. **Web Server**
   - `server.js` - Express server with product listing and Excel export endpoints
   - `api/index.js` - Vercel serverless function wrapper
   - `public/` - Frontend with product display and export controls

4. **Deployment Configuration**
   - `vercel.json` - Vercel serverless configuration with Puppeteer settings
   - `render.yaml` - Render.com deployment configuration
   - `Dockerfile` - Container deployment option

### Data Flow

1. **Smart Update System**: Checks marketplace total counts vs database counts before scraping
2. Scrapers only execute when product counts differ between marketplace and database  
3. Database operations handle upserts, detect removed products, and track changes
4. Web interface displays products and provides Excel export with hyperlinks
5. Export includes image and product URL hyperlinks for easy access

### Smart Scraper Architecture

- `product_count_checker.js` - Compares marketplace vs database product counts
- `smart_scraper.js` - Intelligent scraper manager that only runs when needed
- Server initialization always checks count consistency (not database emptiness)
- Manual updates use smart logic to avoid unnecessary scraping
- Both stores are evaluated independently based on count differences

## Development Commands

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Start production server
npm start

# Build client (if applicable)
npm run build

# Test smart scraper system
node test_smart_update_only.js

# Test new initialization logic
node test_new_initialization.js
```

## Key Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `MAX_PAGES` - Maximum pages to scrape (default: 50 for Yahoo, 45 for Ruten)
- `PAGE_LOAD_WAIT` - Page load wait time in ms (default: 3000)
- `SCRAPE_DELAY` - Delay between pages in ms (default: 1000)
- `NODE_ENV` - Environment setting (affects wait times and delays)

## Database Schema

The `products` table includes:
- `id` - Product ID from the marketplace
- `name` - Product name
- `price` - Product price (integer)
- `image_url` - Product image URL
- `url` - Product page URL  
- `store_type` - Store identifier (yuanzhengshan, youmao)
- `is_active` - Active status (for tracking removed products)
- `scraped_at` - Last scrape timestamp
- `updated_at` - Last update timestamp

## Testing and Debugging Files

- `test_*.js` - Various test scripts for specific scraper functions
- `debug_*.js` - Debugging scripts for troubleshooting scraper issues
- `*.xlsx` - Sample export files with different configurations

## Scraper Architecture Notes

- Both scrapers use intelligent retry mechanisms and error handling
- Image success rate tracking is implemented to ensure quality data
- Batch database operations (every 5 pages) for performance
- Support for both JSON data extraction and DOM parsing fallbacks
- Built-in scroll simulation for lazy-loaded content
- Resource blocking (CSS, fonts) for improved scraping performance

## Deployment Considerations

- Vercel has 30-second function timeout limits
- Puppeteer requires specific Chrome binary paths in production
- Database operations are batched to handle serverless constraints
- Multiple deployment options (Vercel, Render, Docker) with appropriate configurations