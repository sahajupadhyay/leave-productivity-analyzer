# Leave & Productivity Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16.1-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-5.0+-green)](https://www.mongodb.com/)

A production-grade enterprise solution for tracking employee attendance, monitoring leaves, and analyzing team productivity metrics with automated reporting.

## 🚀 Live Demo

Deploy your own instance: [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone)

## 📸 Screenshots

![Dashboard Screenshot](/public/dashboard-preview.png)
*Real-time analytics dashboard with productivity metrics*

## ✨ Key Features

### 📊 Real-Time Analytics Dashboard
- Live productivity metrics updated automatically
- Company-wide and individual employee performance tracking
- Visual indicators for attendance status (Present, Absent, Weekend)
- Monthly trend analysis with historical data access

### 📤 Excel Data Integration
- Seamless bulk import of attendance records via Excel files
- Supports both `.xls` and `.xlsx` file formats
- Automatic data validation and error reporting
- Duplicate prevention with intelligent conflict resolution

### 📅 Automated Monthly Reports
- Complete month-view with day-by-day breakdown
- Automatic gap-filling for missing attendance records
- Expected hours calculation based on configurable business rules
- Export-ready data for further analysis

### 👥 Employee Performance Tracking
- Individual productivity percentages
- Total worked hours vs. expected hours comparison
- Leave balance tracking and utilization reports
- Sortable employee roster with performance metrics

### 🎯 Business Rules Engine
- **Weekday Hours:** 8.5 hours (Monday-Friday)
- **Saturday Hours:** 4.0 hours
- **Sunday:** Designated as weekend (0 hours expected)
- **Productivity Calculation:** `(Total Worked Hours / Total Expected Hours) × 100`
- **Gap Filling:** Missing dates automatically filled as "ABSENT" status

## 🧪 How to Test

A sample Excel file is included in the repository for immediate testing:

**Location:** `public/sample_attendance_format.xlsx`

### Excel Format Requirements

| Column | Header Name | Format | Example |
|--------|------------|--------|---------|
| A | Employee Name | Text | John Doe |
| B | Date | DD-MM-YYYY | 01-12-2024 |
| C | In Time | HH:MM (24h) | 09:00 |
| D | Out Time | HH:MM (24h) | 18:00 |

**Important Notes:**
- Headers must be **exactly** as shown (with spaces, not hyphens)
- Date format: `DD-MM-YYYY` (day-month-year)
- Time format: 24-hour (e.g., 14:00 for 2:00 PM)
- Empty rows are skipped automatically
- Only `.xls` and `.xlsx` files accepted

**Testing Steps:**
1. Start the application (see Installation below)
2. Navigate to http://localhost:3000
3. Click "Choose File" and select `public/sample_attendance_format.xlsx`
4. Click "Upload & Process"
5. View the populated dashboard with sample data

## 🛠 Technology Stack

### Core Framework
- **Next.js 16.1.0** - React framework with App Router and Turbopack
- **React 19** - UI library with Server Components
- **TypeScript 5.x** - Type-safe development with strict mode

### Database & ORM
- **MongoDB** - NoSQL database for flexible data storage
- **Prisma 5.22.0** - Type-safe database ORM with migration support
- **MongoDB Atlas** - Cloud database hosting (recommended)

### UI & Styling
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality React component library
- **Radix UI** - Accessible component primitives
- **Lucide Icons** - Modern icon library

### Data Processing
- **xlsx** - Excel file parsing and generation
- **date-fns** - Date manipulation and formatting
- **Sonner** - Toast notifications for user feedback

### Development Tools
- **ESLint** - Code quality and consistency
- **TypeScript ESLint** - TypeScript-specific linting rules

## 📁 Project Structure

```
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── page.tsx      # Main dashboard
│   │   └── api/          # API routes
│   ├── components/       # React components
│   │   ├── dashboard/    # Dashboard-specific components
│   │   └── ui/           # shadcn/ui components
│   └── lib/              # Utilities and business logic
│       ├── calculations.ts   # Attendance calculations
│       ├── prisma.ts         # Database client
│       └── utils.ts          # Helper functions
├── prisma/
│   └── schema.prisma     # Database schema
└── public/
    └── sample_attendance_format.xlsx   # Sample Excel file
```

## 💻 Local Installation

### Prerequisites

- **Node.js:** Version 18.0 or higher
- **MongoDB Atlas Account** (free tier available)
- **Package Manager:** npm, yarn, pnpm, or bun

### Installation Steps

**1. Clone the Repository**
```bash
git clone <repository-url>
cd KenMark
```

**2. Install Dependencies**
```bash
npm install
```

**3. Configure Environment Variables**
```bash
cp .env.example .env
```

Edit `.env` and add your MongoDB connection string:
```env
DATABASE_URL="mongodb+srv://<username>:<password>@<cluster-url>.mongodb.net/leave_productivity_analyzer?retryWrites=true&w=majority"
```

Replace `<username>`, `<password>`, and `<cluster-url>` with your actual MongoDB Atlas credentials.

**4. Initialize Prisma Client**
```bash
npx prisma generate
```

**5. Push Database Schema**
```bash
npx prisma db push
```

**6. Start the Development Server**
```bash
npm run dev
```

**7. Access the Application**

Open http://localhost:3000 in your browser

## 🚀 Deployment to Vercel

### Prerequisites
- Vercel account (free)
- MongoDB Atlas cluster configured

### Deployment Steps

**1. Push to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

**2. Import to Vercel**
- Go to [vercel.com](https://vercel.com)
- Click "New Project"
- Import your GitHub repository
- Configure project settings

**3. Add Environment Variables**

In Vercel Project Settings → Environment Variables, add:
```
DATABASE_URL=mongodb+srv://<username>:<password>@<cluster-url>.mongodb.net/leave_productivity_analyzer?retryWrites=true&w=majority
```

Replace placeholders with your actual MongoDB Atlas credentials.

**4. Configure MongoDB Atlas**
- Go to MongoDB Atlas → Network Access
- Add IP Address: `0.0.0.0/0` (allows access from anywhere)
- ⚠️ For production, restrict to Vercel's IP ranges

**5. Deploy**
- Click "Deploy"
- Wait for build to complete
- Access your live application at: `https://your-app.vercel.app`

### Post-Deployment
- Test Excel upload functionality
- Verify database connection
- Monitor application logs in Vercel dashboard

## 📡 API Documentation

### POST /api/upload

Upload and process Excel attendance files

**Request:**
- **Method:** POST
- **Content-Type:** multipart/form-data
- **Body:** FormData with `file` field
- **Max File Size:** 10 MB
- **Supported Formats:** `.xls`, `.xlsx`

**Success Response (200):**
```json
{
  "success": true,
  "count": 62,
  "message": "Successfully processed 62 attendance records",
  "details": {
    "employeeCount": 2,
    "recordCount": 62,
    "month": 12,
    "year": 2024
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Validation error",
  "message": "Row 5: Missing required field 'Employee Name'"
}
```

**Processing Features:**
- Automatic employee creation if not exists
- Duplicate detection and prevention
- Batch processing with transaction support
- Comprehensive error reporting with row numbers

## 🔒 Security & Best Practices

### Environment Variables
⚠️ **CRITICAL:** Never commit sensitive files to version control
- `.env` file contains database credentials and must remain private
- Use `.env.example` as a template for new environments
- The `.gitignore` is pre-configured to exclude sensitive files

### Data Protection
- All database operations use Prisma's prepared statements (SQL injection protection)
- File uploads validated for type and size before processing
- MongoDB connection uses authentication and encrypted connections (TLS/SSL)

### Production Deployment Checklist
- [ ] Update `DATABASE_URL` in production environment variables
- [ ] Configure IP whitelist in MongoDB Atlas (use specific IPs, not `0.0.0.0/0`)
- [ ] Enable MongoDB audit logging for compliance
- [ ] Set up automated database backups
- [ ] Configure HTTPS (automatic with Vercel)
- [ ] Review and update CORS policies if needed
- [ ] Enable Vercel Analytics and Monitoring

## 💡 Code Quality Standards

This project adheres to enterprise development standards:

✅ **Type Safety** - TypeScript strict mode with no implicit any  
✅ **Error Handling** - Comprehensive try-catch with custom error classes  
✅ **Code Organization** - SOLID principles and clean architecture  
✅ **Documentation** - Inline JSDoc comments for all public APIs  
✅ **Testing Ready** - Modular code structure supports unit testing  
✅ **Performance** - Server-side rendering and optimized database queries  
✅ **Accessibility** - WCAG 2.1 compliant UI components

## 🆘 Troubleshooting

### Common Issues

**Issue:** Cannot connect to database  
**Solution:** Verify `DATABASE_URL` in `.env` file and check MongoDB Atlas IP whitelist

**Issue:** Excel upload fails with validation error  
**Solution:** Ensure Excel headers match exactly: `Employee Name`, `Date`, `In Time`, `Out Time`

**Issue:** Dates showing incorrect timezone  
**Solution:** System uses UTC internally; adjust display timezone in `calculations.ts` if needed

**Issue:** Vercel deployment fails  
**Solution:** Check build logs, ensure `DATABASE_URL` is set in environment variables

### Getting Help

For technical support or bug reports:
1. Check existing issues in the repository
2. Review error logs in browser console and terminal
3. Verify all prerequisites are met
4. Contact development team with detailed error messages

## 📄 License

MIT License - See LICENSE file for details

---

**Built with ❤️ using Next.js and TypeScript**
