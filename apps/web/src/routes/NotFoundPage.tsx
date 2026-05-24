import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';

export function NotFoundPage() {
  return (
    <Layout>
      <div className="hero">
        <h1>That page got lost in the woods.</h1>
        <p>Let's go back and pick a different path.</p>
        <Link to="/" className="btn">Back to home</Link>
      </div>
    </Layout>
  );
}
