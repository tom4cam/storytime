import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { CreatePage } from './routes/CreatePage';
import { StoryPage } from './routes/StoryPage';
import { EditPage } from './routes/EditPage';
import { NotFoundPage } from './routes/NotFoundPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/s/:id" element={<StoryPage />} />
        <Route path="/s/:id/v/:version" element={<StoryPage />} />
        <Route path="/s/:id/edit" element={<EditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
