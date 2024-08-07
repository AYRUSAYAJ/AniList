const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 4000;
UserId = 0;
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'anime',
});

connection.connect((err) => {
  if (err) throw err;
  console.log('Connected!');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Validate username and password (add your authentication logic here)
  if (username && password) {
    // Check if the user exists in the database
    connection.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
      if (err) {
        console.error('Error querying database:', err.message);
        return res.status(500).send('Internal Server Error');
      }

      if (results.length > 0) {
        UserId = results[0].usrid;
        console.log(UserId);
        res.redirect('/dashboard');
      } else {
        res.redirect('/');
      }
    });
  } else {
    // Invalid input, redirect back to login
    res.redirect('/');
  }
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  connection.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], (err, result) => {
    if (err) {
      console.error('Error inserting into database:', err.message);
      return res.status(500).send('Internal Server Error');
    }
    const insertedUserId = result.insertId;
    connection.query('INSERT INTO user_watch_status (usrid, completed, planning, watching, on_hold, dropped) VALUES (?, 0, 0, 0, 0, 0)', [insertedUserId], (err) => {
      if (err) {
        console.error('Error inserting into user_watch_status table:', err.message);
        return res.status(500).send('Internal Server Error');
      }
      res.redirect('/');
    });
  });
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/search', (req, res) => {
  const searchTerm = req.body.title.toLowerCase();

  const query = 'SELECT * FROM mytable WHERE Title LIKE ? OR title_english LIKE ?';
  connection.query(query, [`%${searchTerm}%`, `%${searchTerm}%`], (err, results) => {
    if (err) {
      console.error('Error querying database:', err.message);
      return res.status(500).send('Internal Server Error');
    }

    res.json(results);
  });
});

app.post('/api/libraryStatus', (req, res) => {
  const animeIds = req.body.animeIds;
  const userId = UserId; // Use the global UserId
  const query = `
  SELECT
    usrid,
    planning,
    watching,
    completed,
    on_hold,
    dropped
  FROM
    user_watch_status
  WHERE
    usrid = ?`;

connection.query(query, [userId], (err, results) => {
  if (err) {
    console.error('Error querying database:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  const libraryStatus = animeIds.map(animeId =>
    results.some(result =>
      result &&
      Object.values(result).some(fieldValue =>
        fieldValue && JSON.stringify(fieldValue).includes(animeId.toString())
      )
    )
  );
    res.json(libraryStatus);
  });
});

app.post('/addToLibrary', (req, res) => {
  const selectedAnimes = req.body.animes;
 // Replace this line with your actual way of getting the user ID

  // Check if UserId is defined
  if (UserId === undefined) {
    console.error('Error: UserId is undefined');
    return res.status(400).json({ error: 'Bad Request' });
  }

  const animeIds = selectedAnimes.map(anime => anime.anime_id);

  // Construct the SQL query using a prepared statement
  const sqlQuery = `
    INSERT INTO user_watch_status (usrid, planning)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      planning = COALESCE(CONCAT(planning, ',', ?), VALUES(planning));
  `;

  // Flatten the array of anime IDs for the parameters
  const params = [UserId, animeIds.join(','), animeIds.join(',')];

  connection.query(sqlQuery, params, (err, results) => {
    if (err) {
      console.error('Error executing query:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    } else {
      console.log('Query executed successfully');
      return res.json({ message: 'Added to Library successfully' });
    }
  });
});

app.get('/api/anime/details/:attribute', (req, res) => {
  const userId = UserId; // Use the global UserId
  const attribute = req.params.attribute;

  // Fetch anime IDs from the specified attribute in user_watch_status
  const sqlQuery = `SELECT ${attribute} FROM user_watch_status WHERE usrid = ${userId}`;
  connection.query(sqlQuery, (err, results) => {
    if (err) {
      console.error('Error querying database:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (!results[0] || results[0][attribute] === undefined || results[0][attribute] === null) {
      // Handle the case where the attribute is undefined or null
      console.error('Attribute not found or is null');
      return res.status(404).json({ error: 'Attribute not found or is null' });
    }

    // Filter out empty strings from the anime IDs
    const animeIds = results[0][attribute].split(',').filter(id => id.trim() !== '');
    console.log(attribute, animeIds);

    // Check if there are valid anime IDs to prevent the syntax error
    if (animeIds.length === 0) {
      console.error('No valid anime IDs found');
      return res.status(404).json({ error: 'No valid anime IDs found' });
    }

    // Fetch anime details from mytable based on the anime IDs
    const placeholders = Array(animeIds.length).fill('?').join(',');
    const animeDetailsQuery = `SELECT * FROM mytable WHERE anime_id IN (${placeholders})`;
    connection.query(animeDetailsQuery, animeIds, (err, animeDetails) => {
      if (err) {
        console.error('Error querying database:', err.message);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      res.json(animeDetails);
    });
  });
});

app.post('/api/anime/changeStatus/:animeId/:newStatus', (req, res) => {
  const userId = UserId; // Use the global UserId
  const animeId = req.params.animeId;
  const newStatus = req.params.newStatus;

  // Retrieve the current status of the anime for the user
  const getCurrentStatusQuery = `SELECT planning, watching, completed, on_hold, dropped
                                 FROM user_watch_status
                                 WHERE usrid = ${userId}`;

  connection.query(getCurrentStatusQuery, (err, results) => {
    if (err) {
      console.error('Error retrieving current status from the database:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    // Extract the current status from the result
    const currentStatus = results.length > 0 ? Object.values(results[0]).join() : '';

    // Update the status in the user_watch_status table
    const updateStatusQuery = `UPDATE user_watch_status
                               SET planning = REPLACE(planning, '${animeId},', ''),
                                   watching = REPLACE(watching, '${animeId},', ''),
                                   completed = REPLACE(completed, '${animeId},', ''),
                                   on_hold = REPLACE(on_hold, '${animeId},', ''),
                                   dropped = REPLACE(dropped, '${animeId},', '')
                               WHERE usrid = ${userId}`;

    connection.query(updateStatusQuery, (err) => {
      if (err) {
        console.error('Error updating status in the database:', err.message);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      // Add the anime ID to the new status only if it's not already present
      const addAnimeIdQuery = `UPDATE user_watch_status
                               SET ${newStatus} = CONCAT(${newStatus}, ',', '${animeId}')
                               WHERE usrid = ${userId} AND ${newStatus} NOT LIKE '%${animeId}%'`;

      connection.query(addAnimeIdQuery, (err) => {
        if (err) {
          console.error('Error updating database:', err.message);
          return res.status(500).json({ error: 'Internal Server Error' });
        }

        res.json({ success: true });
      });
    });
  });
});

app.post('/api/anime/delete/:animeId/:attribute', (req, res) => {
  const usrid = UserId; 
  const animeId = req.params.animeId;
  const attribute = req.params.attribute;
  console.log('Received parameters:', usrid, animeId, attribute);

  // Construct the SQL query to update the specified attribute
  const updateQuery = `UPDATE user_watch_status SET ${attribute} = REPLACE(${attribute}, '${animeId}', '') WHERE usrid = ${usrid}`;

  connection.query(updateQuery, (err, results) => {
    if (err) {
      console.error('Error updating database:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    res.json({ message: 'Anime deleted successfully' });
  });
});

app.listen(port, () => {
  console.log(`Server listening on port http://localhost:${port}`);
});
