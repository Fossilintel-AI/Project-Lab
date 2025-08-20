
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt, {hash} from "bcrypt";
import fs from "fs";
import  path from "path";
import multer from "multer"

//use for path finding
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

//convert pdf to text and cohere
import { CohereClientV2 } from 'cohere-ai'; // Import Cohere's SDK
import pdfParse from 'pdf-parse';

//sessions and passport for cookies
import session from "express-session";
import passport from "passport";
import {Strategy} from "passport-local";

//email sender
import nodemailer from "nodemailer";

//allow all domains
import cors from "cors";


//Youtube and google
import { google } from 'googleapis';
import dotenv from 'dotenv';




const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
// Serve static files from Workstation directory
app.use('/Workstation', express.static(path.join(__dirname, 'Workstation')));

app.use(cors());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

//encryption
const saltRounds = 10;
global.user_id = -1;
global.currentSubject = null;

//sessions and cookies.
app.use(session({
    secret:"WebApplication",
    resave:false,
    saveUninitialized:true,
    cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json()); // This is necessary to parse the body in JSON format //09 May 2025

dotenv.config();

//Youtube
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.Youtube_API_KEY // API Key
});


// Set storage engine for Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!global.user_id || !global.currentSubject) {
            return cb(new Error("User ID or Subject is missing"));
        }

        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides`);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

//for admin upload
// Set storage engine for Multer
const Adminstorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!global.user_id || !global.currentSubject) {
            return cb(new Error("User ID or Subject is missing"));
        }

        const dir = path.join(__dirname, `./public/Course/${global.currentSubject}/slides`);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

// Initialize Adminupload middleware
const Adminupload = multer({
    storage: Adminstorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        const fileTypes = /pdf/;
        const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = fileTypes.test(file.mimetype);

        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed!"));
        }
    }
});

// Initialize upload middleware
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        const fileTypes = /pdf/;
        const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = fileTypes.test(file.mimetype);

        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed!"));
        }
    }
});


//database
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "website",
    password: "Mankael123456",
    port: 5432,
});
db.connect((err) => {
    if (err) {
        console.error("Failed to connect to the database:", err.stack);
    } else {
        console.log("Connected to the database.");
    }
});

//for To-do List
let items = [
];

//Time table useful variables and function
let timetable = [
];
const subjectColors = {};
const predefinedColors = [
    "#ffcc00", "#ff5733", "#28a745", "#17a2b8", "#6610f2",
    "#e83e8c", "#6f42c1", "#fd7e14", "#20c997", "#dc3545"
];
function getSubjectColor(subject) {
    if (!subjectColors[subject]) {
        const hash = [...subject].reduce((acc, char) => acc + char.charCodeAt(0), 0);
        subjectColors[subject] = predefinedColors[hash % predefinedColors.length];
    }
    return subjectColors[subject];
}


//LLM Cohere and Questions Generation
// Initialize Cohere client with your API key
const cohere = new CohereClientV2({
    token: 'SWaeBAPGPwj2ClLJ3ToDPqipg6sVGNvfCIrLDo9p', // Your Cohere API key
});

//videos
let videos = [];


function getVideosForSubject(subject) {
    const videosPath = path.join(__dirname, "public", "Course", subject, "videos");

    if (!fs.existsSync(videosPath)) return []; // No folder yet

    const files = fs.readdirSync(videosPath);

    // Map to video objects
    const videoList = files.map((filename, index) => ({
        id: Date.now() + index, // temporary id for the session
        title: filename.replace(/\d+-/, '').replace(/\.[^/.]+$/, ''), // strip timestamp & extension
        filename,
        subject
    }));

    return videoList;
}



// Function to extract text from PDF
async function extractTextFromPDF(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        return pdfData.text;
    } catch (error) {
        console.error('Error parsing PDF:', error);
        throw error;
    }
}

// Function to generate the summarize  using Cohere
async function generateSummarize(text) {
    try {
        // const prompt = `Based on the following text, generate a set of questions and Answers Text in the form as key: value pair object {dont include question and answer tags ,let the answer start with ***}:\n\nText: ${text}`;
        const prompt = `Based on the following text, Generate a descriptive summary of the whole context covered 



Text:${text}
`;

        const response = await cohere.chat({
            model: 'command-r-plus',
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        if (response.message && Array.isArray(response.message.content) && response.message.content[0].text) {
            const generatedText = response.message.content[0].text.trim();
            return generatedText;
        } else {
            throw new Error('Unexpected response structure');
        }
    } catch (error) {
        console.error('Error generating questions:', error);
        throw error;
    }
}


//Function to generate questions using Cohere
async function generateQuestions(text) {
    try {
        // const prompt = `Based on the following text, generate a set of questions and Answers Text in the form as key: value pair object {dont include question and answer tags ,let the answer start with ***}:\n\nText: ${text}`;
        const prompt = `Based on the following text, generate a set of questions and answers in the form of key-value pairs as an array of objects. Each object should contain a "question" and an "answer" field, return the array no words above it and please dont add "" on the array start and end, no newline. The output should look like this:

[
  { "question": "What is an apple?", "answer": "A fruit" },
  { "question": "What is 2 + 2?", "answer": "4" },
  { "question": "Who discovered gravity?", "answer": "Isaac Newton" }
]

Text:${text}
`;

        const response = await cohere.chat({
            model: 'command-r-plus',
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        if (response.message && Array.isArray(response.message.content) && response.message.content[0].text) {
            const generatedText = response.message.content[0].text.trim();
            return generatedText;
        } else {
            throw new Error('Unexpected response structure');
        }
    } catch (error) {
        console.error('Error generating questions:', error);
        throw error;
    }
}

// Function to generate Youtube search  using Cohere
async function generateYoutubeSearch(text) {
    try {
        // const prompt = `Based on the following text, generate a set of questions and Answers Text in the form as key: value pair object {dont include question and answer tags ,let the answer start with ***}:\n\nText: ${text}`;
        const prompt = `with the following text, please create a short headline title I can use to search a video relating to the text in youtube, It should only be the headline only nothing else, very short for a search
:${text}`;

        const response = await cohere.chat({
            model: 'command-r-plus',
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        if (response.message && Array.isArray(response.message.content) && response.message.content[0].text) {
            const generatedText = response.message.content[0].text.trim();
            return generatedText;
        } else {
            throw new Error('Unexpected response structure');
        }
    } catch (error) {
        console.error('Error generating questions:', error);
        throw error;
    }
}



//Email sender settings
const transporter = nodemailer.createTransport({
    service: "gmail", // Change this if using another email provider
    auth: {
        user: "fossil.application@gmail.com", // Replace with your email
        pass: "rgegmcxlctqrzjar"  // Use an App Password for Gmail
    }
});

function sendWelcomeEmail(userEmail, userName) {
    const mailOptions = {
        from: "fossil.application@gmail.com",
        to: userEmail,
        subject: "Welcome to EverythingLearn - Your Personalized e-Learning Hub!",
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #8c7258;">Welcome to EverythingLearn, ${userName}!</h2>
                <p>Dear ${userName},</p>
                <p>We’re thrilled to have you as part of our learning community. EverythingLearn is designed to enhance your educational journey with powerful features that help you stay organized and engaged.</p>
                
                <h3 style="color: #a58b69;">Here’s what you can do on EverythingLearn:</h3>
                <ul>
                    <li>📚 Explore and enroll in courses tailored to your interests.</li>
                    <li>📝 Access lecture notes, textbooks, and self-study resources.</li>
                    <li>✅ Keep track of your tasks with the built-in To-Do list.</li>
                    <li>📅 Plan your schedule with our interactive Timetable feature.</li>
                    <li>📖 Track the books you've read and gain insights from them.</li>
                    <li>🎯 Test your knowledge with AI-generated quizzes.</li>
                </ul>
                
                <p>We're committed to making your learning experience as smooth as possible.</p>
                
                <h3 style="color: #a58b69;">Need Help?</h3>
                <p>If you ever have any questions or encounter any issues, our support team is here to assist you.</p>
                <p>📧 <strong>Email:</strong> <a href="mailto:fossilintel@gmail.com">fossilintel@gmail.com</a></p>
                
                <p>Start your learning adventure today and make the most of your educational journey!</p>
                
                <p style="margin-top: 20px;">Best regards,</p>
                <p><strong>The EverythingLearn Team</strong></p>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error sending email:", error);
        } else {
            console.log("Welcome email sent:", info.response);
        }
    });
}

//Main ,Login and Sign-up Route
app.get("/", async (req, res) => {

    if(req.isAuthenticated()) {

    const currentUser = req.user;
     const   AdminFlag = "The admin is here";
    const subscription_type = currentUser.subscription_type;
    res.render("index.ejs", { user: user_id !== -1 ? "user Present" : null,subscription_type, isAdmin:AdminFlag });
    }
    else
    {
        res.render("index.ejs", { user: user_id !== -1 ? "user Present" : null });
    }



    //res.render("index.ejs", );
    //res.render("test.ejs");
});
app.get("/dashboard", async (req, res) => {
    if (req.isAuthenticated()) {
        const currentUser = req.user;
        const subscription_type = currentUser.subscription_type;
        const userEmail = req.user.email;

        if (userEmail == "admin@gmail.com") {
            try {
                // Fetch unapproved documents
                const unapprovedDocuments = await db.query(
                    "SELECT file_directory, file_name FROM pdfUploads WHERE isApproved != 'Approved' AND isApproved != 'Declined'"
                );

                // Fetch messages from students
                const studentMessages = await db.query(
                    "SELECT name, email, subject, message, created_at, isRead FROM studentcontact WHERE isRead = false"
                );

                // Fetch assignment attempts with student names
                const assignmentAttempts = await db.query(`
                    SELECT aa.*, u.first_name, u.last_name, u.email 
                    FROM assignment_attempts aa
                    JOIN users u ON aa.user_id = u.user_id
                    ORDER BY aa.attempt_date DESC
                `);

                res.render('admin-dashboard.ejs', {
                    unapprovedDocuments: unapprovedDocuments.rows,
                    studentMessages: studentMessages.rows,
                    assignmentAttempts: assignmentAttempts.rows,
                    user: "user Present",
                    subscription_type
                });

            } catch (error) {
                console.error(error);
                res.status(500).send('Something went wrong');
            }
        } else {
            res.render("welcome.ejs", {
                user: "user Present",
                subscription_type
            });
        }
    } else {
        res.redirect("/login");
    }
});
app.get("/about", async (req, res) => {

    res.render("about.ejs", { user: user_id !== -1 ? "user Present" : null });
    // res.render("about.ejs", );
    //res.render("test.ejs");
});
app.get("/contact", async (req, res) => {

    res.render("contact.ejs", { user: user_id !== -1 ? "user Present" : null });

    //res.render("contact.ejs", );
    //res.render("test.ejs");
});
app.get("/login", async (req, res) => {
    console.log("we are here1");
    res.render("login.ejs" );
});
app.get("/register", async (req, res) => {
    res.render("signup.ejs" );
    // res.render("index.ejs", { secret: "" ,user: ""});
});
app.get("/terms", async (req, res) => {
    res.render("terms.ejs" );
    // res.render("index.ejs", { secret: "" ,user: ""});
});
app.get("/faq", async (req, res) => {
    res.render("FAQ.ejs" );
    // res.render("index.ejs", { secret: "" ,user: ""});
});
app.post('/subscribe-newsletter', async (req, res) => {
    const { email } = req.body;
    console.log(req.body);

    // Basic validation
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    try {
        // Check if the email is already subscribed
        const existingSubscriber = await db.query("SELECT * FROM subscribers WHERE email = $1", [email.toLowerCase()]);

        if (existingSubscriber.rows.length > 0) {
            return res.json({ success: false, message: 'You are already subscribed.' });
        }

        // Insert new subscriber
        await db.query("INSERT INTO subscribers (email) VALUES ($1)", [email.toLowerCase()]);

        return res.json({ success: true, message: 'Thank you for subscribing!' });
    } catch (err) {
        console.error('Newsletter subscription error:', err);
        return res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
    }
});
// Handle contact form submission
app.post('/send-message', (req, res) => {
    const { name, email, subject, message } = req.body;
    //console.log(req.body);

    // Insert query following your preferred format
    const query = "INSERT INTO studentcontact (name, email, subject, message) VALUES ($1, $2, $3, $4)";
    const values = [name, email, subject, message];

    db.query(query, values, (err, result) => {
        if (err) {
            console.error('Error inserting data into studentcontact table: ', err);
            return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
        }

        res.status(200).json({ success: true, message: 'Your message has been sent successfully!' });
        //res.redirect('/contact');
    });
});


// Backend route to handle sending reply emails
app.post('/admin/send-reply', async (req, res) => {
    const { email, message } = req.body;

    // Update the isRead field in the database
    try {
        await db.query(
            "UPDATE studentcontact SET isRead = true WHERE email = $1 AND isRead = false",
            [email]
        );
        console.log('Message marked as read.');
    } catch (err) {
        console.error('Error updating isRead field:', err);
        return res.status(500).send('Failed to mark message as read.');
    }

    // Construct the email
    const mailOptions = {
        from: 'fossil.application@gmail.com',
        to: email,  // Student's email
        subject: 'Reply from Admin',
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #8c7258;">Admin's Reply</h2>
                <p>Dear Student,</p>
                <p>${message}</p>
                <p>Best regards,<br><strong>The Admin Team</strong></p>
            </div>
        `
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error sending email:", error);
            return res.status(500).send('Failed to send reply.');
        }
        console.log("Reply email sent:", info.response);
        return res.status(200).send('Reply sent successfully.');
    });
});

app.post("/signup", async (req, res) => {
    const { first_name, last_name, email, password, bio, home_address, subscription_type } = req.body;
    console.log("We in the sign up")
    // Check if any of the required fields are empty
    if (!first_name || !last_name || !email || !password || !bio || !home_address || !subscription_type) {
        return res.render("signup.ejs", { error: "All fields are required!" });
    }

    try {
        // Check if the email already exists
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (checkResult.rows.length > 0) {
            return res.render("signup.ejs", { error: "Email already exists. Try logging in." });
        }

        // Hash the password
        bcrypt.hash(password, saltRounds, async (err, hash) => {
            if (err) {
                console.log("Error hashing the password", err);
                return res.render("signup.ejs", { error: "An error occurred. Please try again." });
            }

            try {
                // Insert the new user into the database, including bio, home address, and subscription type
                const result = await db.query(
                    "INSERT INTO users (first_name, last_name, email, password,subscription_type, bio, address ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
                    [first_name, last_name, email, hash,subscription_type, bio, home_address]
                );

                const user = result.rows[0];
                const checkResultID = await db.query("SELECT user_id FROM users WHERE email = $1", [email]);
                const userData = checkResultID.rows[0];
                user_id = userData.user_id;

                // Send Welcome Email
                sendWelcomeEmail(user.email, user.first_name);

                // Automatically log the user in after signup
                req.login(user, (err) => {
                    if (err) {
                        console.error("Login error after signup:", err);
                        return res.render("signup.ejs", { error: "Login failed after signup. Please try logging in." });
                    }
                    return res.redirect("/main"); // Redirect user to main page after login
                });

            } catch (error) {
                console.log("Error inserting user:", error);
                return res.render("signup.ejs", { error: "An error occurred. Please try again." });
            }
        });
    } catch (err) {
        console.log("Error checking for existing email:", err);
        return res.render("signup.ejs", { error: "An error occurred. Please try again." });
    }
});
// app.get("/main", async (req, res) => {
//     if(req.isAuthenticated())
//     {
//
//         const currentUser = req.user;
//         const subscription_type = currentUser.subscription_type;
//         const userEmail =  req.user.email;
//         const unapprovedDocuments = await db.query("SELECT file_directory, file_name FROM pdfUploads WHERE isApproved != 'Approved' AND isApproved != 'Declined'");
//
//         if(userEmail == "admin@gmail.com" && unapprovedDocuments.rows.length != 0){
//             try {
//
//                 console.log("Database Query Result:", unapprovedDocuments); // Log full result
//                 console.log("Unapproved Documents:", unapprovedDocuments.rows); // Log rows array
//                 // Pass unapproved documents data to the admin dashboard
//
//
//                 res.render('admin-dashboard.ejs', {  unapprovedDocuments: unapprovedDocuments.rows , user: user_id !== -1 ? "user Present" : null,subscription_type});
//             } catch (error) {
//                 console.error(error);
//                 res.status(500).send('Something went wrong');
//             }
//         }
//         else{
//             res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,subscription_type  });
//         }
//
//
//         //res.render("welcome.ejs");
//     }
//     else{
//         res.redirect("/login");
//     }
//     // Render the welcome page with the books
//
// });
app.get("/main", async (req, res) => {
    if (req.isAuthenticated()) {
        const currentUser = req.user;
        const subscription_type = currentUser.subscription_type;

        res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null, subscription_type });

    } else {
        res.redirect("/login");
    }
});


passport.use(new Strategy({
    usernameField: 'email',  // The name of the input field in the form for the email
    passwordField: 'password'  // The name of the input field in the form for the password
}, async function verify(email, password, cb) {
    console.log("Strategy called with:", email, password);
    try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const storedHashPassword = user.password;

            bcrypt.compare(password, storedHashPassword, (err, isMatch) => {
                if (err) {
                    return cb(err);
                }
                if (isMatch) {
                    user_id = user.user_id;
                    return cb(null, user);
                } else {
                    return cb(null, false, { message: "Incorrect password" });
                }
            });
        } else {
            return cb(null, false, { message: "User not found" });
        }
    } catch (err) {
        console.log("Database query error:", err);
        return cb(err);
    }
}));


app.post("/login", (req, res, next) => {

    console.log("Received credentials:", req.body);
    passport.authenticate("local", (err, user, info) => {
        if (err) {
            console.error("Authentication error:", err);
            return res.redirect("/login");
        }
        if (!user) {
            console.log("Authentication failed:", info.message);  // Get the error message from info
            return res.render("login.ejs", { error: info.message });  // Render login with the error message
        }
        req.login(user, (err) => {
            if (err) {
                console.error("Error logging in:", err);
                return res.redirect("/login");
            }
            console.log("User successfully logged in");
            return res.redirect("/main");
        });
    })(req, res, next);
});


//Logging out
app.get("/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            user_id = -1;
            res.redirect("/"); // Redirect to login page after logout
        });
    });
});

//user Profile
// app.get("/profile", async (req, res) => {
//     if (!req.isAuthenticated()) {
//         return res.redirect("/login");
//     }
//
//     try {
//         const currentUser = {
//             first_name: req.user.first_name,
//             last_name: req.user.last_name,
//             email: req.user.email,
//             subscription_type: req.user.subscription_type,
//             bio: req.user.bio,
//             created_at: req.user.created_at,
//             address: req.user.address,
//             user_id: req.user.user_id // Make sure we have the user_id
//         };
//
//         // Fetch the student's assignment attempts
//         const assignmentAttempts = await db.query(`
//             SELECT aa.*, u.first_name, u.last_name, u.email
//             FROM assignment_attempts aa
//             JOIN users u ON aa.user_id = u.user_id
//             WHERE aa.user_id = $1
//             ORDER BY aa.attempt_date DESC
//         `, [currentUser.user_id]);
//
//         res.render("profile.ejs", {
//             currentUser,
//             assignmentAttempts: assignmentAttempts.rows,
//             user: "user Present"
//         });
//
//     } catch (error) {
//         console.error("Error loading profile:", error);
//         res.status(500).send("Error loading profile");
//     }
// });
app.get("/profile", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }
    try {
        const currentUser = {
            first_name: req.user.first_name,
            last_name: req.user.last_name,
            email: req.user.email,
            subscription_type: req.user.subscription_type,
            bio: req.user.bio,
            created_at: req.user.created_at,
            address: req.user.address,
            user_id: req.user.user_id
        };

        // Fetch assignment attempts
        const assignmentAttempts = await db.query(`
            SELECT aa.*, u.first_name, u.last_name, u.email 
            FROM assignment_attempts aa
            JOIN users u ON aa.user_id = u.user_id
            WHERE aa.user_id = $1
            ORDER BY aa.attempt_date DESC
        `, [currentUser.user_id]);

        // 🔹 Fetch progress summary per subject
        const progressSummary = await db.query(`
            SELECT subject,
                   COUNT(*) FILTER (WHERE is_completed = true) AS completed,
                   COUNT(*) AS total
            FROM progress
            WHERE user_id = $1
            GROUP BY subject
        `, [currentUser.user_id]);

        res.render("profile.ejs", {
            currentUser,
            assignmentAttempts: assignmentAttempts.rows,
            progressSummary: progressSummary.rows,
            user: "user Present"
        });

    } catch (error) {
        console.error("Error loading profile:", error);
        res.status(500).send("Error loading profile");
    }
});



app.get("/edit-profile", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }
    const currentUser = req.user;
    res.render("edit-profile.ejs", { currentUser,user: user_id !== -1 ? "user Present" : null});
});
app.post("/edit-profile", (req, res) => {
    const { first_name, last_name, bio, address } = req.body;
    // Assume you have an `updateUserProfile` function to update the database


    db.query("UPDATE users SET first_name = $1, last_name = $2, bio = $3, address = $4 WHERE user_id = $5", [first_name, last_name, email, bio, address, user_id])
        .then(() => {
            req.user.first_name = first_name;
            req.user.last_name = last_name;
            //req.user.email = email;
            req.user.bio = bio;
            req.user.address = address;
            // Redirect to the profile page after a successful update
            res.redirect("/profile");
        })
        .catch((err) => {
            // Handle any errors
            console.error("Error updating profile:", err);
            res.status(500).send("Error updating profile");
        });
});



//The Book Feature
app.get("/books", async (req, res) => {

    //res.render("index.ejs", );
    //book feature

    if(req.isAuthenticated())
    {
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        res.render("booksRead.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });

        //res.render("booksRead.ejs", {books: books});
    }
    else{
        res.redirect("/login");
    }

});
app.get('/newbook', (req, res) => {
    if(req.isAuthenticated())
    {
        res.render("newbook.ejs", { user: user_id !== -1 ? "user Present" : null,listTitle:"Add a New Book" });

        //res.render('newbook.ejs',{listTitle:"Add a New Book"});
    }
    else{
        res.redirect("/login");
    }

   //Renders the newbook.ejs file
});
app.post('/add-book', async (req, res) => {

    if(req.isAuthenticated())
    {
        const {title, date, rating, notes} = req.body;
        const item = req.body.newItem;
        db.query("INSERT INTO readBooks (title,date,rating,notes,userid) VALUES($1,$2,$3,$4,$5)", [title, date, rating, notes, user_id]);
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        //res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null, books:books });
        res.redirect("/books");
        //res.render("welcome.ejs",{books:books});
    }
    else{
        res.redirect("/login");
    }


});
app.get("/delete", (req, res) => {
    //I need to change this to delete not get

    if(req.isAuthenticated())
    {
        const bookId = parseInt(req.query.id, 10);

        db.query("Delete FROM readBooks WHERE id = $1",[bookId],async (err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
                const books = booksResult.rows;
                //res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });
                res.redirect("/books");
                //res.render("welcome.ejs", {books: books});
            }
        });
    }
    else{
        res.redirect("/login");
    }

});
app.get("/edit", async (req, res) => {

    if(req.isAuthenticated())
    {
        const bookId = parseInt(req.query.id, 10); // Ensure bookId is an integer
        const result = await db.query("SELECT * FROM readBooks WHERE id = $1", [bookId]); // Use parameterized queries to prevent SQL injection

        console.log(result.rows[0]); // This will log the fetched book

        if (result.rows.length > 0) {
            res.render("editBook.ejs", { user: user_id !== -1 ? "user Present" : null,book: result.rows[0] });

            //res.render("editBook.ejs", { book: result.rows[0] }); // Pass the first row to the template
        } else {
            res.status(404).send('Book not found'); // Handle case if no book is found
        }
    }
    else{
        res.redirect("/login");
    }

});
app.post('/edit-book', async (req, res) => {

    if(req.isAuthenticated())
    {
        const {title, date, rating, notes} = req.body;
        const id = parseInt(req.query.id, 10);
        const item = req.body.newItem;
        db.query("UPDATE readBooks SET title = $1 , date = $2 , rating= $3 , notes = $4 WHERE id = $5", [title, date, rating, notes, id]);
        const booksResult = await db.query("SELECT * FROM readBooks WHERE userid = $1", [user_id]);
        const books = booksResult.rows;
        //res.render("welcome.ejs", { user: user_id !== -1 ? "user Present" : null,books: books });
        res.redirect("/books");
        //res.render("welcome.ejs", {books: books});
    }
    else{
        res.redirect("/login");
    }

});


//To-do Feature
app.get("/todo-list", async (req, res) => {

    if(req.isAuthenticated())
    {
        //res.render("index.ejs", );
        //Todo feature
        const result = await db.query("SELECT * FROM items WHERE userid = $1", [user_id]);
        items = result.rows;

        res.render("todolist.ejs", {
            listTitle: "Today",
            listItems: items,
            user: user_id !== -1 ? "user Present" : null,
        });
    }
    else{
        res.redirect("/login");
    }

});
app.post("/addItem", (req, res) => {
    if(req.isAuthenticated())
    {
        const item = req.body.newItem;
        db.query("INSERT INTO items (title,userid) VALUES($1,$2)",[item,user_id]);
        res.redirect("/todo-list");
    }
    else{
        res.redirect("/login");
    }


});
app.post("/editItem", (req, res) => {
    if(req.isAuthenticated())
    {
        console.log(req.body);
        db.query("UPDATE items SET title = $1 WHERE id = $2",[req.body.updatedItemTitle,req.body.updatedItemId],(err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                res.redirect("/todo-list");
            }
        });
    }
    else{
        res.redirect("/login");
    }


});
app.post("/deleteItem", (req, res) => {
    if(req.isAuthenticated())
    {
        //needs to change to delete not post
        console.log(req.body);

        db.query("Delete FROM items WHERE id = $1",[req.body.deleteItemId],(err, result) => {
            if (err) {
                console.error("Error updating item:", err.stack);
            } else {
                console.log("Item updated successfully!");
                res.redirect("/todo-list");
            }
        });
    }
    else{
        res.redirect("/login");
    }


});

//The forum feature
app.get("/forums", async (req, res) => {
    if(req.isAuthenticated())
    {
        const { subject } = req.query; // Get the selected subject from query params
        const subjects = [
            "Programming 1",
            "Programming 3",
            "Calculus",
            "Business Law",
            "Data Driven System",
            "Object Oriented Design"
        ];

        let forumData = [];
        let subjectSelected = false;

        if (subject) {
            subjectSelected = true;
            // Fetch forum posts filtered by selected subject
            const forumResult = await db.query("SELECT * FROM forum_posts WHERE subject = $1", [subject]);
            forumData = forumResult.rows;
        }
        const userEmail =  req.user.email;
        var AdminFlag = "";
        if(userEmail == "admin@gmail.com"){
            AdminFlag = "The admin is here";
        }

        res.render("forum.ejs", { forumData, subjects, selectedSubject: subject, subjectSelected,user: user_id !== -1 ? "user Present" : null,isAdmin: AdminFlag });
    }
    else{
        res.redirect("/login");
    }


});
app.post("/addforum", async (req, res) => {
    if(req.isAuthenticated())
    {
        const { name, surname, topic, problem, selectedSubject } = req.body;
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format

        try {
            await db.query(
                "INSERT INTO forum_posts (name, surname, subject, topic, problem, date) VALUES ($1, $2, $3, $4, $5, $6)",
                [name, surname, selectedSubject, topic, problem, date]
            );
            res.redirect(`/forums?subject=${selectedSubject}`); // Redirect back to the selected subject
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding forum post");
        }
    }
    else{
        res.redirect("/login");
    }


});
app.post('/addAdminCommentForum', async (req, res) => {
    if(req.isAuthenticated()) {
        const {comment, postId} = req.body;
        // Assuming you have a function to update the admin comment in the database

        try {
            await db.query(
                "UPDATE forum_posts SET admin_comment = $1 WHERE id = $2 ",
                [comment, postId]
            );
            res.redirect('/forums?subject=' + req.query.subject); // Redirect back to the forum page
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding forum post");
        }
    }
    else{
        res.redirect("/login");
    }
});


//The course
// app.get("/course/:subject", async (req, res) => {
//     if(req.isAuthenticated())
//     {
//         const currentUser = req.user;
//         const subscription_type = currentUser.subscription_type;
//         const subject = req.params.subject;
//         const slidesPath = path.join(__dirname, "public", "Course", subject, "slides");
//         currentSubject = subject;
//
//
//
//         let slides = [];
//
//         try {
//             // Read all slide filenames in the subject's slides folder
//             slides = fs.readdirSync(slidesPath)
//                 .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
//                 .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)
//
//         } catch (error) {
//             console.error("Error reading slides:", error);
//         }
//         const slidesPathPersonal = path.join(__dirname, "Workstation", String(user_id), subject, "slides");
//
//         let personalslides = [];
//         try {
//             // Read all slide filenames in the subject's slides folder
//             personalslides = fs.readdirSync(slidesPathPersonal)
//                 .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
//                 .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)
//
//         } catch (error) {
//             console.error("Error reading slides:", error);
//         }
//
//
//
//         // Render course.ejs with the subject and slides
//         res.render("course.ejs", { subject, slides,personalslides,userid:user_id, user: user_id !== -1 ? "user Present" : null,subscription_type });
//     }
//     else{
//         res.redirect("/login");
//     }
//
//
// });


// app.get("/course/:subject", async (req, res) => {
//     if(req.isAuthenticated())
//     {
//         const currentUser = req.user;
//         const subscription_type = currentUser.subscription_type;
//         const subject = req.params.subject;
//         const slidesPath = path.join(__dirname, "public", "Course", subject, "slides");
//         currentSubject = subject;
//
//
//
//         let slides = [];
//
//         try {
//             // Read all slide filenames in the subject's slides folder
//             slides = fs.readdirSync(slidesPath)
//                 .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
//                 .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)
//
//         } catch (error) {
//             console.error("Error reading slides:", error);
//         }
//         const slidesPathPersonal = path.join(__dirname, "Workstation", String(user_id), subject, "slides");
//
//         let personalslides = [];
//         try {
//             // Read all slide filenames in the subject's slides folder
//             personalslides = fs.readdirSync(slidesPathPersonal)
//                 .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
//                 .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // Sort numerically (Lecture 01, 02...)
//                 .map(file => ({ file_path: file, isApproved: "Pending" })); // Default to false
//
//             console.log(personalslides);
//             console.log(slidesPathPersonal);
//             // Fetch approval status from the database
//             const results = await db.query("SELECT file_directory, file_name, isApproved FROM pdfUploads WHERE file_directory = $1", [slidesPathPersonal]);
//             console.log(results);
//             // Create a lookup table from the database results
//             const approvalMap = new Map(results.rows.map(row => [path.basename(row.file_name), row.isapproved])); // Ensure you're mapping from results.rows
//
//             console.log("Approval Map:", approvalMap);
//             // Update personalslides with database approval status if found
//             personalslides = personalslides.map(slide => ({
//                 file_path: slide.file_path,
//                 isApproved: approvalMap.has(slide.file_path)
//                     ? (approvalMap.get(slide.file_path) === 'Approved' ? 'Approved' : (approvalMap.get(slide.file_path) === 'Declined' ? 'Declined' : 'Pending'))
//                     : 'Pending'
//             }));
//             console.log("Updated Personal Slides:", personalslides);
//         } catch (error) {
//             console.error("Error reading slides:", error);
//         }
//
//         //reading the file name
//         const assignmentsDir = path.join(__dirname, "public", "Course", subject, "assignments");
//
//         // Read assignments if directory exists
//         let assignments = [];
//         if (fs.existsSync(assignmentsDir)) {
//             const assignmentFiles = fs.readdirSync(assignmentsDir)
//                 .filter(f => f.endsWith(".json"))
//                 .map(file => {
//                     const filePath = path.join(assignmentsDir, file);
//                     const data = JSON.parse(fs.readFileSync(filePath));
//                     return {
//                         filename: file,
//                         title: data.title,
//                         questionCount: data.questions.length,
//                         totalMarks: data.questions.reduce((sum, q) => sum + q.marks, 0)
//                     };
//                 });
//             assignments = assignmentFiles;
//         }
//
//
//         const userEmail =  req.user.email;
//         var AdminFlag = "";
//         if(userEmail == "admin@gmail.com"){
//             AdminFlag = "The admin is here";
//         }
//         // Render course.ejs with the subject and slides
//         res.render("course.ejs", { subject,assignments, slides,personalslides,userid:user_id, user: user_id !== -1 ? "user Present" : null,subscription_type,isAdmin:AdminFlag,existingAssignment: null, filename: null });
//     }
//     else{
//         res.redirect("/login");
//     }
//
//
// });
app.get("/course/:subject", async (req, res) => {
    if(req.isAuthenticated())
    {
        const currentUser = req.user;
        const subscription_type = currentUser.subscription_type;
        const subject = req.params.subject;
        const slidesPath = path.join(__dirname, "public", "Course", subject, "slides");
        currentSubject = subject;

        let slides = [];

        try {
            // Read all slide filenames in the subject's slides folder
            slides = fs.readdirSync(slidesPath)
                .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // Sort numerically (Lecture 01, 02...)

        } catch (error) {
            console.error("Error reading slides:", error);
        }
        const slidesPathPersonal = path.join(__dirname, "Workstation", String(currentUser.user_id), subject, "slides");

        let personalslides = [];
        try {
            // Read all slide filenames in the subject's slides folder
            personalslides = fs.readdirSync(slidesPathPersonal)
                .filter(file => file.endsWith(".pdf")) // Adjust file type if needed
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // Sort numerically (Lecture 01, 02...)
                .map(file => ({ file_path: file, isApproved: "Pending" })); // Default to false

            console.log(personalslides);
            console.log(slidesPathPersonal);
            // Fetch approval status from the database
            const results = await db.query("SELECT file_directory, file_name, isApproved FROM pdfUploads WHERE file_directory = $1", [slidesPathPersonal]);
            console.log(results);
            // Create a lookup table from the database results
            const approvalMap = new Map(results.rows.map(row => [path.basename(row.file_name), row.isapproved])); // Ensure you're mapping from results.rows

            console.log("Approval Map:", approvalMap);
            // Update personalslides with database approval status if found
            personalslides = personalslides.map(slide => ({
                file_path: slide.file_path,
                isApproved: approvalMap.has(slide.file_path)
                    ? (approvalMap.get(slide.file_path) === 'Approved' ? 'Approved' : (approvalMap.get(slide.file_path) === 'Declined' ? 'Declined' : 'Pending'))
                    : 'Pending'
            }));
            console.log("Updated Personal Slides:", personalslides);
        } catch (error) {
            console.error("Error reading slides:", error);
        }

        //reading the file name
        const assignmentsDir = path.join(__dirname, "public", "Course", subject, "assignments");

        // Read assignments if directory exists
        let assignments = [];
        if (fs.existsSync(assignmentsDir)) {
            const assignmentFiles = fs.readdirSync(assignmentsDir)
                .filter(f => f.endsWith(".json"))
                .map(file => {
                    const filePath = path.join(assignmentsDir, file);
                    const data = JSON.parse(fs.readFileSync(filePath));
                    return {
                        filename: file,
                        title: data.title,
                        subject: data.subject,
                        questionCount: data.questions.length,
                        totalMarks: data.questions.reduce((sum, q) => sum + q.marks, 0),
                        deadline: data.deadline || null,
                        isTimed: data.isTimed || false,
                        timeLimit: data.timeLimit || null,
                    };
                });


            // Check attempt status for each assignment
            for (let i = 0; i < assignmentFiles.length; i++) {
                const attempt = await db.query(
                    `SELECT grade FROM assignment_attempts 
                     WHERE user_id = $1 AND filename = $2`,
                    [currentUser.user_id, assignmentFiles[i].filename]
                );

                assignmentFiles[i].attempted = attempt.rows.length > 0;
                assignmentFiles[i].grade = attempt.rows[0]?.grade || null;
            }

            assignments = assignmentFiles;
        }

        const userEmail =  req.user.email;
        var AdminFlag = "";
        if(userEmail == "admin@gmail.com"){
            AdminFlag = "The admin is here";
        }

        // ✅ Fetch completed slides for this student
        let completedSlides = [];
        try {

            // ✅ Insert missing slides into progress table with default is_completed = false
            if(AdminFlag == ""){
                for (const slide of slides) {
                    await db.query(
                        `INSERT INTO progress (user_id, subject, content_name, is_completed)
                 VALUES ($1, $2, $3, false)
                 ON CONFLICT (user_id, subject, content_name) DO NOTHING`,
                        [currentUser.user_id, subject, slide]
                    );
                }
            }



            const result = await db.query(
                `SELECT content_name FROM progress 
             WHERE user_id = $1 AND subject = $2 AND is_completed = true`,
                [currentUser.user_id, subject]
            );
            completedSlides = result.rows.map(row => row.content_name);
        } catch (err) {
            console.error("Error fetching progress:", err);
        }


        const videoList = getVideosForSubject(subject);

        const subjectVideos = videoList.filter(v => v.subject === subject);

        // Render course.ejs with the subject and slides
        res.render("course.ejs", {
            subject,
            assignments,
            slides,
            completedSlides,   // ✅ pass to frontend
            personalslides,
            userid: currentUser.user_id,
            user: "user Present",
            subscription_type,
            isAdmin: AdminFlag,
            existingAssignment: null,
            filename: null,
            videos: subjectVideos
        });
    }
    else{
        res.redirect("/login");
    }
});

//progress
app.post("/progress/update", async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect("/login");

    let { subject, content_name, is_completed } = req.body;
    const userId = req.user.user_id;

    // ✅ Handle array case (["false", "true"]) or single value
    if (Array.isArray(is_completed)) {
        is_completed = is_completed.includes("true");
    } else {
        is_completed = is_completed === "true";
    }

    try {
        await db.query(
            `INSERT INTO progress (user_id, subject, content_name, is_completed)
             VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, subject, content_name)
             DO UPDATE SET is_completed = EXCLUDED.is_completed`,
            [userId, subject, content_name, is_completed]
        );
        res.redirect("back");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating progress");
    }
});



app.post("/uploadPdf", upload.single('pdfFile'),  async (req, res) => {
    // if (!req.file) {
    //     return res.status(400).send('No file uploaded.');
    // }
    if(req.isAuthenticated())
    {

        console.log("We are uploading");
        const filePath = path.join(`/Users/harveyfossil/Desktop/BME 4th Sem/Web development/Project-Lab/Workstation/${global.user_id}/${global.currentSubject}/slides`, req.file.originalname);
        const fileName = req.file.originalname;
        const fileDirectory = path.dirname(filePath);
        const isApproved = "Pending";  // Default to false until approval

        try {
            // Insert the file data into the database
            await db.query("INSERT INTO pdfUploads (file_directory, file_name, isApproved) VALUES ($1, $2, $3)", [fileDirectory, fileName, isApproved]);

            // Redirect to the course page after upload
            res.redirect(`/course/${global.currentSubject}`);
        } catch (dbError) {
            console.error("Database error:", dbError);
            //res.status(500).send('Error updating database');
            res.redirect(`/course/${global.currentSubject}`);

        }
    }
    else{
        res.redirect("/login");
    }


});
app.post("/AdminuploadPdf", Adminupload.single('pdfFile'),  async (req, res) => {
    // if (!req.file) {
    //     return res.status(400).send('No file uploaded.');
    // }
    if(req.isAuthenticated())
    {

        const filePath = path.join(`/Users/harveyfossil/Desktop/BME 4th Sem/Web development/Project-Lab/public/${global.currentSubject}/slides`, req.file.originalname);
        const fileName = req.file.originalname;
        const fileDirectory = path.dirname(filePath);


        try {

            // Redirect to the course page after upload
            res.redirect(`/course/${global.currentSubject}`);
        } catch (dbError) {
            console.error("Database error:", dbError);
            //res.status(500).send('Error updating database');
            res.redirect(`/course/${global.currentSubject}`);

        }
    }
    else{
        res.redirect("/login");
    }


});

//The Time table feature
app.get('/timetable', async (req, res) => {
    if(req.isAuthenticated())
    {
        try {
            //const user_id = req.session.user_id || 1; // Replace with actual session user ID
            const result = await db.query(
                `SELECT * FROM timetable WHERE userid = $1`,
                [user_id]
            );
            console.log(user_id);
            const timetable = result.rows; // Extract results

            console.log(timetable); // Debugging: print fetched timetable

            res.render('timetable.ejs', { timetable,user: user_id !== -1 ? "user Present" : null });
        } catch (err) {
            console.error('Error fetching timetable:', err);
            res.status(500).send('Error fetching timetable');
        }

    }
    else{
        res.redirect("/login");
    }



});
app.post('/addSubject', async(req, res) => {

    if(req.isAuthenticated())
    {
        const { day, startTime, endTime, subject, classType } = req.body;

        // Get color for subject
        const color = getSubjectColor(subject);

        // Generate new ID
        //const newId = timetable.length ? Math.max(...timetable.map(entry => entry.id)) + 1 : 1;

        // Validate that startTime is before endTime
        if (startTime >= endTime) {
            return res.render('timetable.ejs', { timetable: [], errorMessage: "Start time must be before end time.",user: user_id !== -1 ? "user Present" : null });
        }

        // Check for overlapping times
        const conflict = timetable.some(entry =>
            entry.day === day &&
            !(
                (endTime <= entry.startTime) || (startTime >= entry.endTime) // No overlap condition
            )
        );

        if (conflict) {
            return res.render('timetable.ejs', { timetable, errorMessage: "Time slot overlaps with another subject.",user: user_id !== -1 ? "user Present" : null });
        }

        // Add the new subject with the assigned color
        try {
            await db.query(`INSERT INTO timetable (day, starttime, endtime, subject, classtype, color, userid)
        VALUES ($1, $2, $3, $4, $5, $6, $7) `, [day, startTime, endTime, subject, classType, color, user_id]);
            //timetable.push({ id: newId, day, startTime, endTime, subject, classType, color });

        } catch (err) {
            console.error('Error adding timetable entry:', err);
            res.status(500).send('Error adding timetable entry');
        }

        res.redirect('/timetable');
    }
    else{
        res.redirect("/login");
    }

});
app.post("/deleteSubject", async (req, res) => {
    if(req.isAuthenticated())
    {
        const { subject, day, startTime,subjectID } = req.body;
        console.log("We are deleting");
        console.log(req.body);
        //const user_id = req.session.user_id || 1; // Replace with actual session user ID

        try {

            await db.query(`DELETE FROM timetable  WHERE userid = $1 AND subject = $2 AND day = $3 AND id = $4`, [user_id, subject, day,subjectID]);

            res.redirect("/timetable");
        } catch (err) {
            console.error("Error deleting timetable entry:", err);
            res.status(500).send("Error deleting timetable entry");
        }
    }
    else{
        res.redirect("/login");
    }


});

//PDF viewer
// app.get('/pdfview/:document', async (req, res) => {
//     if(req.isAuthenticated())
//     {
//         console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }
//
//         const document = req.params.document;
//         const slidesPath = path.join(__dirname, "public", "Course", currentSubject, "slides");
//
//         // Construct the relative URL for the PDF
//         const pdfUrl = path.join('/Course', currentSubject, 'slides', document); // relative path
//
//         // Get all the PDF files in the directory
//         const filess = fs.readdirSync(slidesPath).filter(file => file.endsWith('.pdf'));
//
//         // Filter the files to find the specific document by matching the name
//         const files = filess.find(file => file.replace('.pdf', '') === document.replace('.pdf', ''));
//
//         if (!files) {
//             return res.status(404).send('PDF file not found');
//         }
//
//         console.log(pdfUrl); // Logs the relative URL
//
//         res.render('pdfviewer.ejs', { pdfUrl,user: user_id !== -1 ? "user Present" : null }); // Pass pdfUrl to the template
//     }
//     else{
//         res.redirect("/login");
//     }
//
//
// });
app.get('/pdfview/:document', async (req, res) => {
    if (req.isAuthenticated()) {
        console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }
        const document = req.params.document;

        // Define paths for both program slides and personal slides
        const filePath = path.join(__dirname, "public", "Course", global.currentSubject, "slides", document);
        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides/${document}`);

        console.log("Checking paths:");
        console.log("Program Slide Path:", filePath);
        console.log("Personal Slide Path:", dir);

        let finalPath = null;
        let pdfUrl = null;

        // Determine the correct file path
        if (fs.existsSync(filePath)) {
            finalPath = filePath;
            pdfUrl = path.join("/Course", global.currentSubject, "slides", document); // URL for program slides
        } else if (fs.existsSync(dir)) {
            finalPath = dir;
            pdfUrl = path.join("/Workstation", global.user_id.toString(), global.currentSubject, "slides", document); // URL for personal slides
        } else {
            return res.status(404).send("PDF file not found.");
        }

        console.log("Serving PDF:", pdfUrl);
        res.render("pdfviewer.ejs", {
            pdfUrl,
            user: global.user_id !== -1 ? "user Present" : null,
        });
    } else {
        res.redirect("/login");
    }
});


//flash-cards for Questions
// app.get('/generateQuestions/:document', async (req, res) => {
//     if (req.isAuthenticated()) {
//         console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }
//
//         const document = req.params.document;
//         const filePath = path.join(__dirname, "public", "Course", currentSubject, "slides", document); // relative path
//         const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides/${document}`);
//         console.log(dir);
//         console.log(filePath);
//
//         try {
//             if (!fs.existsSync(filePath)) {
//                 return res.status(404).send('File not found.');
//             }
//
//             console.log("We are in the right track");
//
//             const text = await extractTextFromPDF(filePath);
//             const questions = await generateQuestions(text);
//             const jsonObject = JSON.parse(questions);
//
//             const filePath2 = 'public/jsons/questions_and_answers.json';
//
//             // Write the data to the JSON file asynchronously
//             fs.writeFile(filePath2, JSON.stringify(jsonObject, null, 4), (err) => {
//                 if (err) {
//                     console.log("Error writing to file:", err);
//                     return res.status(500).send('Error saving questions.');
//                 }
//
//                 console.log(`Data has been saved to ${filePath2}`);
//
//                 // Make sure to send the response here
//                 return res.redirect("/flashcards"); // or another route as needed
//             });
//         } catch (error) {
//             console.error("Error generating questions:", error);
//             return res.status(500).send('Error generating questions: ' + error.message);
//         }
//     } else {
//         res.redirect("/login");
//     }
// });

app.get('/generateQuestions/:document', async (req, res) => {
    if (req.isAuthenticated()) {
        console.log(req.params); // Logs: { document: 'BUSINESS LAW 1 - Introduction to law.pdf' }
        const document = req.params.document;

        // Define paths
        const filePath = path.join(__dirname, "public", "Course", global.currentSubject, "slides", document);
        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides/${document}`);

        console.log("Checking paths:");
        console.log("Program Slide Path:", filePath);
        console.log("Personal Slide Path:", dir);

        let finalPath = null;

        // 🔴 FIX: Choose the correct path based on existence
        if (fs.existsSync(filePath)) {
            finalPath = filePath; // Use program slide path
        } else if (fs.existsSync(dir)) {
            finalPath = dir; // Use personal slide path
        } else {
            return res.status(404).send("File not found.");
        }

        try {
            console.log("Processing file:", finalPath);
            const text = await extractTextFromPDF(finalPath);
            const questions = await generateQuestions(text);
            console.log("Raw Questions Data:", questions);
            const jsonObject = JSON.parse(questions);

            const filePath2 = 'public/jsons/questions_and_answers.json';
            fs.writeFile(filePath2, JSON.stringify(jsonObject, null, 4), (err) => {
                if (err) {
                    console.error("Error writing to file:", err);
                    return res.status(500).send("Error saving questions.");
                }
                console.log(`Data saved to ${filePath2}`);
                return res.redirect("/flashcards");
            });
        } catch (error) {
            console.error("Error generating questions:", error);
            return res.status(500).send("Error generating questions: " + error.message);
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/getFlashcards", async (req, res) => {
    if (req.isAuthenticated()) {
        const filePath = "public/jsons/questions_and_answers.json";
        try {
            // Use fs.promises.access() to check file existence
            await fs.promises.access(filePath, fs.constants.F_OK);

            const data = await fs.promises.readFile(filePath, "utf8");
            res.json(JSON.parse(data));
        } catch (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist
                res.status(404).json({ message: "No flashcards available" });
            } else {
                console.error("Error reading file:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        }
    } else {
        res.redirect("/login");
    }
});


app.get("/flashcards", (req, res) => {
    if(req.isAuthenticated())
    {
        res.render("flashcards.ejs",{currentSubject, user: user_id !== -1 ? "user Present" : null});
    }
    else{
        res.redirect("/login");
    }


});


app.get("/summarize/:document", async (req, res) => {
    if (req.isAuthenticated()) {
        const document = req.params.document;

        // Define paths for both program slides and personal slides
        const filePath = path.join(__dirname, "public", "Course", global.currentSubject, "slides", document);
        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides/${document}`);

        console.log("Checking paths:");
        console.log("Program Slide Path:", filePath);
        console.log("Personal Slide Path:", dir);

        let finalPath = null;

        // Determine the correct file path
        if (fs.existsSync(filePath)) {
            finalPath = filePath;
        } else if (fs.existsSync(dir)) {
            finalPath = dir;
        } else {
            return res.status(404).send("File not found.");
        }

        try {
            console.log("File found, extracting text...");
            const text = await extractTextFromPDF(finalPath);

            console.log("Generating summary...");
            const summary = await generateSummarize(text);

            console.log("Summary generated:", summary);
            res.render("summarize.ejs", {
                summary,
                user: global.user_id !== -1 ? "user Present" : null
            });
        } catch (error) {
            console.error("Error generating summary:", error);
            return res.status(500).send('Error generating Summary: ' + error.message);
        }
    } else {
        res.redirect("/login");
    }
});


app.get("/youtubeRecommendation/:document", async (req, res) => {
    if (req.isAuthenticated()) {
        const document = req.params.document;

        // Define paths for both program slides and personal slides
        const filePath = path.join(__dirname, "public", "Course", global.currentSubject, "slides", document);
        const dir = path.join(__dirname, `./Workstation/${global.user_id}/${global.currentSubject}/slides/${document}`);

        console.log("Checking paths:");
        console.log("Program Slide Path:", filePath);
        console.log("Personal Slide Path:", dir);

        let finalPath = null;

        // Determine the correct file path
        if (fs.existsSync(filePath)) {
            finalPath = filePath;
        } else if (fs.existsSync(dir)) {
            finalPath = dir;
        } else {
            return res.status(404).send("File not found.");
        }

        try {
            console.log("File found, extracting text...");
            const text = await extractTextFromPDF(finalPath);

            console.log("Generating summary...");
            const searchTitle = await generateYoutubeSearch(text);

            console.log("Search text generated:", searchTitle);
            res.render("videoRecommendation.ejs", {
                searchTitle,
                user: global.user_id !== -1 ? "user Present" : null
            });
        } catch (error) {
            console.error("Error generating summary:", error);
            return res.status(500).send('Error generating Summary: ' + error.message);
        }
    } else {
        res.redirect("/login");
    }
});


//upgrade feature
app.get("/upgrade", async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            // Get the current user's subscription plan (you can fetch more details if needed)
            const result = await db.query(
                "SELECT subscription_type FROM users WHERE email = $1",
                [req.user.email]
            );

            const subscriptionType = result.rows[0].subscription_type; // Get the current subscription plan

            // Render the upgrade page, passing the current subscription plan to the template
            res.render("upgrade.ejs", { subscriptionType,  user: user_id !== -1 ? "user Present" : null });
        } catch (err) {
            console.error(err);
            res.status(500).send("Error loading upgrade page");
        }
    } else {
        res.redirect("/login"); // Redirect to login if the user is not authenticated
    }
});
app.post("/upgrade", async (req, res) => {
    console.log(req.body);
    if (req.isAuthenticated()) {
        const { subscription_type } = req.body;  // Get the selected subscription plan
        console.log(req.body);

        try {
            // Update the user's subscription plan in the database
            await db.query(
                "UPDATE users SET subscription_type = $1 WHERE email = $2",
                [subscription_type, req.user.email]  // Assuming the user's email is stored in req.user.email
            );

            // Update the subscription_type directly in req.user
            req.user.subscription_type = subscription_type;

            // You can also send back a response with the updated subscription
            //res.json({ success: true, subscription_type: req.user.subscription_type });

            // Alternatively, redirect to a profile or other page with updated data
            res.redirect("/profile");  // Uncomment this if you prefer to redirect

        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating subscription plan");
        }
    } else {
        res.redirect("/login");  // Redirect to login if the user is not authenticated
    }
});

app.get('/view-document', (req, res) => {
    const filePath = decodeURIComponent(req.query.path);

    // Security: Ensure path is inside the allowed directory
    const basePath = '/Users/harveyfossil/Desktop/BME 4th Sem/Web development/Project-Lab/Workstation';
    if (!filePath.startsWith(basePath)) {
        return res.status(403).send('Access Denied');
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File Not Found');
    }

    // Serve the PDF
    res.sendFile(filePath);
});



app.post("/assignment/save", (req, res) => {
    const { title, questions, filename, subject, deadline, isTimed, timeLimit } = req.body;

    if (!title || !questions) {
        return res.status(400).json({ success: false, message: "Title and questions are required" });
    }

    const safeTitle = title.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    const assignmentFilename = `${safeTitle}.json`;
    const assignmentsDir = path.join(__dirname, "public", "Course", subject, "assignments");

    try {
        if (!fs.existsSync(assignmentsDir)) {
            fs.mkdirSync(assignmentsDir, { recursive: true });
        }

        const filePath = path.join(assignmentsDir, assignmentFilename);

        const assignmentData = {
            title,
            subject,
            deadline,
            isTimed,
            timeLimit: isTimed ? timeLimit : null,
            questions,
            filename: assignmentFilename,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(assignmentData, null, 2));

        res.json({
            success: true,
            message: "Assignment saved successfully",
            filename: assignmentFilename,
            path: filePath
        });
    } catch (err) {
        console.error("Error saving assignment:", err);
        res.status(500).json({
            success: false,
            message: "Error saving assignment",
            error: err.message
        });
    }
});

//new
app.get("/assignments/info/:filename", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ status: 'unauthenticated' });

    const { filename } = req.params;
    try {
        const assignmentPath = path.join(__dirname, "public", "Course", currentSubject, "assignments", filename + ".json");
        const assignmentData = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));

        const now = new Date();
        const deadline = new Date(assignmentData.deadline);

        if (now > deadline) {
            return res.json({ status: 'late' });
        } else {
            return res.json({ status: 'on-time' });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: 'error', error: err.message });
    }
});
app.post("/assignments/force-submit/:filename", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });

    const { filename } = req.params;
    const userId = req.user.user_id;

    try {
        const assignmentPath = path.join(__dirname, "public", "Course", currentSubject, "assignments", filename + ".json");
        const assignmentData = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));

        const now = new Date();
        const deadline = new Date(assignmentData.deadline);
        if (now <= deadline) return res.status(400).json({ message: "Assignment is still open." });

        // Check if already submitted
        const attempt = await db.query(
            `SELECT * FROM assignment_attempts WHERE user_id = $1 AND filename = $2`,
            [userId, filename + ".json"]
        );
        if (attempt.rows.length > 0) return res.status(400).json({ message: "Already submitted." });

        // Insert grade 0
        await db.query(
            `INSERT INTO assignment_attempts (user_id, subject, assignment_title, filename, grade)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, currentSubject, assignmentData.title, filename + ".json", 0]
        );

        return res.status(200).json({ message: "Auto-submission successful with grade 0" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Error during auto-submission", error: err.message });
    }
});



//check if assignment is attempted
app.get('/assignments/check/:filename', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ attempted: false });
    }

    const { filename } = req.params;
    const userId = req.user.user_id;

    try {
        const check = await db.query(
            `SELECT 1 FROM assignment_attempts WHERE user_id = $1 AND filename = $2`,
            [userId, filename + ".json"]
        );

        res.json({ attempted: check.rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ attempted: false });
    }
});



app.get('/Course/:subject/assignments/:filename', async (req, res) => {
    try {
        const userEmail = req.user.email;
        const userId = req.user.user_id;
        const { subject, filename } = req.params;

        const assignmentPath = path.join(__dirname, "public", "Course", subject, "assignments", filename + ".json");
        const assignmentData = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));

        // Check if already attempted
        const attempt = await db.query(
            `SELECT 1 FROM assignment_attempts WHERE user_id = $1 AND filename = $2`,
            [userId, filename + ".json"]
        );

        if (attempt.rows.length > 0) {
            return res.status(403).send("You have already attempted this assignment.");
        }

        res.render('assignmentView.ejs', {
            assignment: assignmentData,
            subject: subject,
            filename: filename,
            isAdmin: userEmail === "admin@gmail.com"
        });
    } catch (err) {
        console.error('Error loading assignment:', err);
        res.status(500).send('Error loading assignment');
    }
});


app.delete("/course/:subject/assignments/:filename", (req, res) => {
    const { subject, filename } = req.params;
    const filePath = path.join(__dirname, "public", "Course", subject, "assignments", filename);
    console.log("Attempting to read:", filePath); // Debug log
    try {
        fs.unlinkSync(filePath);
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting assignment:", err);
        res.status(500).json({ success: false, message: "Could not delete assignment" });
    }
});

// //grading
// app.post("/assignments/submit/:filename", async (req, res) => {
//     if (!req.isAuthenticated()) {
//         return res.status(401).json({ message: "Not authenticated" });
//     }
//
//     const { filename } = req.params;
//     const { answers } = req.body; // Now this will be an array
//     const userId = req.user.user_id;
//
//     try {
//         // 1. Load the assignment
//         const assignmentPath = path.join(__dirname, "public", "Course", currentSubject, "assignments", filename+".json");
//         const assignmentData = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));
//
//         // 2. Check if already attempted
//         const existingAttempt = await db.query(
//             `SELECT * FROM assignment_attempts
//              WHERE user_id = $1 AND filename = $2`,
//             [userId, filename+".json"] // Make sure this matches your filename format
//         );
//
//         if (existingAttempt.rows.length > 0) {
//             return res.status(400).json({
//                 message: "You have already submitted this assignment"
//             });
//         }
//
//         // 3. Grade the assignment
//         let totalScore = 0;
//         let maxScore = 0;
//         const gradedAnswers = [];
//
//         assignmentData.questions.forEach((question, index) => {
//             maxScore += question.marks;
//             const studentAnswer = answers[index]; // Now using simple array index
//             let isCorrect = false;
//             let score = 0;
//
//             if (question.type === 'mcq' || question.type === 'truefalse') {
//                 isCorrect = studentAnswer === question.correct;
//                 score = isCorrect ? question.marks : 0;
//             } else {
//                 // For written answers, we'll just give partial credit
//                 score = question.marks * 0.5; // 50% for attempting
//                 isCorrect = null; // Manual grading needed
//             }
//
//             totalScore += score;
//             gradedAnswers.push({
//                 question: question.question,
//                 correctAnswer: question.correct,
//                 studentAnswer,
//                 isCorrect,
//                 marks: question.marks,
//                 awardedMarks: score
//             });
//         });
//
//         const grade = Math.round((totalScore / maxScore) * 100);
//
//         // 4. Save to database
//          await db.query(
//             `INSERT INTO assignment_attempts
//              (user_id, subject, assignment_title, filename, grade)
//              VALUES ($1, $2, $3, $4, $5)`,
//             [
//                 userId,
//                 currentSubject,
//                 assignmentData.title,
//                 filename+".json", // Consistent filename format
//                 grade,
//
//             ]
//         );
//
//         res.redirect('/main');
//
//     } catch (error) {
//         console.error("Error submitting assignment:", error);
//         res.status(500).json({
//             message: "Error submitting assignment",
//             error: error.message
//         });
//     }
// });
app.post("/assignments/submit/:filename", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    const { filename } = req.params;
    const userId = req.user.user_id;
    const subject = req.body.subject || currentSubject; // Get subject from frontend or use current

    let answers = [];

    // Handle different answer formats
    if (Array.isArray(req.body.answers)) {
        answers = req.body.answers;
    } else if (typeof req.body.answers === 'object') {
        answers = Object.values(req.body.answers);
    }

    try {
        // 1. Load the assignment JSON
        const assignmentPath = path.join(__dirname, "public", "Course", subject, "assignments", filename + ".json");
        const assignmentData = JSON.parse(fs.readFileSync(assignmentPath, 'utf-8'));

        // 2. Check if already attempted
        const existingAttempt = await db.query(
            `SELECT * FROM assignment_attempts
             WHERE user_id = $1 AND filename = $2`,
            [userId, filename + ".json"]
        );

        if (existingAttempt.rows.length > 0) {
            return res.status(400).json({
                message: "You have already submitted this assignment"
            });
        }

        // 3. Grade the assignment
        let totalScore = 0;
        let maxScore = 0;
        const gradedAnswers = [];

        assignmentData.questions.forEach((question, index) => {
            maxScore += question.marks;
            const studentAnswer = answers[index] || ''; // Handle missing answers
            let isCorrect = false;
            let score = 0;

            if (question.type === 'mcq' || question.type === 'truefalse') {
                isCorrect = studentAnswer === question.correct;
                score = isCorrect ? question.marks : 0;
            } else {
                // Written answer gets partial credit
                score = studentAnswer.trim() ? question.marks * 0.5 : 0;
                isCorrect = null;
            }

            totalScore += score;

            gradedAnswers.push({
                question: question.question,
                correctAnswer: question.correct,
                studentAnswer,
                isCorrect,
                marks: question.marks,
                awardedMarks: score
            });
        });

        const grade = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

        // 4. Save submission to DB
        await db.query(
            `INSERT INTO assignment_attempts
             (user_id, subject, assignment_title, filename, grade)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                userId,
                subject,
                assignmentData.title,
                filename + ".json",
                grade

            ]
        );

        // Return JSON response instead of redirect
        res.json({
            success: true,
            grade: grade,
            totalScore: totalScore,
            maxScore: maxScore
        });

    } catch (error) {
        console.error("Error submitting assignment:", error);
        res.status(500).json({
            message: "Error submitting assignment",
            error: error.message
        });
    }
});

app.get("/admin/attempt/:attemptId", async (req, res) => {
    try {
        const { attemptId } = req.params;
        const result = await db.query(`
            SELECT aa.*, u.first_name, u.last_name, u.email 
            FROM assignment_attempts aa
            JOIN users u ON aa.user_id = u.user_id
            WHERE aa.attempt_id = $1
        `, [attemptId]);

        if (result.rows.length > 0) {
            res.json({
                success: true,
                attempt: result.rows[0]
            });
        } else {
            res.status(404).json({
                success: false,
                message: "Attempt not found"
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});
//approving file
app.post('/admin/approve/:fileName', async (req, res) => {
    const fileName = req.params.fileName;

    try {
        // Update the document to set isApproved to true
        const result = await db.query(`
            UPDATE pdfUploads 
            SET isApproved = 'Approved' 
            WHERE file_name = $1
        `, [fileName]);

      res.redirect("/main");
    } catch (error) {
        console.error(error);
        res.status(500).send('Error approving document');
    }
});

app.post('/admin/decline/:fileName', async (req, res) => {
    const fileName = req.params.fileName;

    try {
        // Update the document to set isApproved to true
        const result = await db.query(`
            UPDATE pdfUploads 
            SET isApproved = 'Declined' 
            WHERE file_name = $1
        `, [fileName]);

        res.redirect("/main");
    } catch (error) {
        console.error(error);
        res.status(500).send('Error approving document');
    }
});


//Study stream
// Route to search for study videos
app.get('/search', async (req, res) => {
    try {
        console.log(req.query.q);
        const query = req.query.q || 'study videos'; // Default search
        const response = await youtube.search.list({
            part: 'snippet',
            q: query,
            maxResults: 20,
            type: 'video'
        });

        res.json(response.data.items);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route to search for study videos
app.get('/studystream', async (req, res) => {
    res.render("videos.ejs");
});
// Multer storage
const Videostorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const filePath = path.join(__dirname, "public", "Course", currentSubject, "videos");
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(filePath, { recursive: true });
        }
        cb(null, filePath);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    },
});

// Use `storage:` not `Videostorage` key
const Videoupload = multer({ storage: Videostorage });

// Serve the entire `public/Course` folder under `/videos`
app.use("/videos", express.static(path.join(__dirname, "public", "Course")));

// Upload video route
app.post("/uploadVideo", Videoupload.single("videoFile"), (req, res) => {
    const { title } = req.body;
    if (!req.file) {
        return res.status(400).send("No video uploaded.");
    }

    const newVideo = {
        id: Date.now(),
        title,
        filename: req.file.filename,  // just filename, path can be built dynamically
        subject: currentSubject       // store subject
    };
    videos.push(newVideo);


    res.redirect("back"); // Redirects back to the same page
});

// Delete video route
app.post("/deleteVideo/:id", (req, res) => {
    const videoId = parseInt(req.params.id);
    const video = videos.find((v) => v.id === videoId);

    if (!video) {
        return res.status(404).send("Video not found.");
    }

    // Delete file
    const filePath = path.join(__dirname, "public", "Course", video.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // Remove from array
    videos = videos.filter((v) => v.id !== videoId);

    res.redirect("back");
});






//sessions and passport
passport.serializeUser((user, cb) => {
    cb(null, user);
});

passport.deserializeUser((user, cb) => {

    cb(null, user);
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

