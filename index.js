const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const multer = require("multer");
const csv = require("fast-csv");
const cors = require("cors");
const jwt = require('jsonwebtoken');

require('dotenv').config();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 4306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "lms",
};

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded." });
    }

    const fileBuffer = req.file.buffer.toString();
    const csvData = [];

    csv
      .parseString(fileBuffer, { headers: true })
      .on("data", (row) => {
        csvData.push(row);
      })
      .on("end", async () => {
        console.log("Server: Creating database connection");
        const connection = await mysql.createConnection(dbConfig);
        console.log("Server: Database connection created");

        await connection.execute(`
          CREATE TABLE IF NOT EXISTS uploaded_values (
            id INT AUTO_INCREMENT PRIMARY KEY,
            \`Name\` CHAR(30),
            \`Mobile Number\` VARCHAR(15),
            Email VARCHAR(30),
            \`Assign_to\` CHAR(30),
            \`Lead Stage\` VARCHAR(30) DEFAULT 'Fresh',
            compositeKey VARCHAR(255) NOT NULL,
            uploadTimestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_updated DATE,
            remarks VARCHAR(255)
            
          );
        `);

        console.log("Server: Inserting data into the database");
        for (const row of csvData) {
          const formattedDate = row.date
            ? new Date(row.date).toISOString()
            : null;
          await connection.execute(
            `
            INSERT INTO uploaded_values( \`Name\`, \`Mobile Number\`, Email, \`Assign_to\`, \`Lead Stage\`, compositeKey, uploadTimestamp, last_updated, remarks) 
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,?, ?);
          `,
            [
              row.Name || null,
              row["Mobile Number"] || null,
              row.Email || null,
              row.Assign_to || null,
              "Fresh",
              `${row.Name}_${row["Mobile Number"]}_${row.Email}`,
              formattedDate,
              ''
            ]
          );
        }
        console.log("Server: Data inserted successfully");
        await connection.end();

        console.log("Server: CSV data uploaded successfully");

        res.status(200).json({
          message: "CSV data uploaded to MySQL database successfully.",
        });
      });
  } catch (error) {
    console.error("Error:", error);
    console.error("Error Stack Trace:", error.stack);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/leads", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    const [rows] = await connection.execute(
      "SELECT *, DATE_FORMAT(last_updated, '%Y-%m-%d') as formatted_last_updated, remarks FROM uploaded_values ORDER BY uploadTimestamp DESC"

    );

    const [usersResult] = await connection.execute(
      "SELECT `Full Name` FROM signup"
    );

    await connection.end();

    const userNames = usersResult.map((user) => user['Full Name']);

    //console.log("Fetched leads with dates:", leadsResult);
    console.log("Fetched user names:", userNames);

    


    console.log("Fetched leads with dates:", rows);

    const datesFromLeads  = rows.map((lead) => ({
      ...lead,
      date: lead.formatted_last_updated ? new Date(lead.formatted_last_updated) : null,
      userNames,
    }));

    const leadsWithUsers = datesFromLeads.map((lead) => ({
      ...lead,
      userNames,
    }));
  
    // res.status(200).json({ leads: leadsWithUsers });
    // res.status(200).json({ leads: datesFromLeads });
    res.status(200).json({ leads: leadsWithUsers, userNames });

    // res.status(200).json({ leads: rows });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/update-leads", async (req, res) => {
  try {
    console.log("Received data in update-leads endpoint:", req.body);
    const connection = await mysql.createConnection(dbConfig);

    const updates = req.body.leads.map(async (lead) => {
      const updateQuery = lead.date
        ? "UPDATE uploaded_values SET `Assign_to` = ?, `Lead Stage` = ?, `last_updated` = ?, `remarks` = ? WHERE CONCAT(`Name`, '_', `Mobile Number`, '_', `Email`) = ?"
        : "UPDATE uploaded_values SET `Assign_to` = ? , `Lead Stage` = ?, `remarks` = ? WHERE CONCAT(`Name`, '_', `Mobile Number`, '_', `Email`) = ?";

      const formattedDate = lead.date
        ? new Date(lead.date).toISOString().split("T")[0]
        : null;

      console.log("Incoming date:", lead.date);

      // const queryParams = lead.date
      //   ? [lead.selectedLeadStage, formattedDate, lead.Remarks, lead.compositeKey]
      //   : [lead.selectedLeadStage, lead.Remarks, lead.compositeKey];

      const queryParams = lead.date
      ? [
          lead.Assign_to || null,
          lead.selectedLeadStage || null,
          formattedDate || null,
          lead.remarks || null,
          lead.compositeKey,
        ]
      : [lead.Assign_to || null, lead.selectedLeadStage || null, lead.remarks || null, lead.compositeKey];

      console.log("Received leads for update:", req.body.leads);

      console.log("Update query:", updateQuery);
      console.log("Query parameters:", queryParams);

      return connection.execute(
        updateQuery,
        queryParams

        //"UPDATE uploaded_values SET `Lead Stage` = COALESCE(?, `Lead Stage`) WHERE CONCAT(`Name`, '_', `Mobile Number`, '_', `Email`) = ?",
        //[lead.selectedLeadStage, lead.compositeKey]
      );
    });

    await Promise.all(updates);

    const [updatedRows] = await connection.execute(
      "SELECT * FROM uploaded_values ORDER BY uploadTimestamp DESC"
    );

    await connection.end();

    res.status(200).json({ updatedLeads: updatedRows });
  } catch (error) {
    console.error("Error updating lead stages:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
});

app.post('/signup', async (req, res) => {
  try {
    const { fullname, email, password } = req.body;

    // Add validation logic if needed

    const connection = await mysql.createConnection(dbConfig);

    const [result] = await connection.execute(
      'INSERT INTO signup (`Full Name`, Email, Password) VALUES (?, ?, ?)',
      [fullname, email, password]
    );

    await connection.end();

    res.status(201).json({ message: 'Signup successful', userId: result.insertId });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const connection = await mysql.createConnection(dbConfig);

    const [rows] = await connection.execute(
      'SELECT * FROM signup WHERE email = ? AND password = ?',
      [email, password]
    );

    const user = { email: req.body.email }; // Change this to your user object
    const token = jwt.sign(user, 'trustisthekey', { expiresIn: '1h' });

    // res.status(200).json({ token });

    await connection.end();

    if (rows.length > 0) {
      // User authenticated
      res.status(200).json({ message: 'Login successful', token});
    } else {
      // Authentication failed
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


app.get('/users', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    const [rows] = await connection.execute(
      'SELECT `Full Name`, Email FROM signup'
    );

    await connection.end();

    res.status(200).json({ users: rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add a new endpoint in the backend
app.get("/user-names", async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);

    // Fetch names of signed-up users from the database
    const [usersResult] = await connection.execute(
      "SELECT `Full Name` FROM signup"
    );

    await connection.end();

    // Extract names from the result
    const userNames = usersResult.map((user) => user["Full Name"]);

    res.status(200).json({ userNames });
  } catch (error) {
    console.error("Error fetching user names:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
