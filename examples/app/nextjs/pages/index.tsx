import { useQuery } from 'react-query';
import { request, gql } from 'graphql-request';

export default function Index() {
  const { data, isLoading } = useQuery('hello', async () => {
    const { hello } = await request<{
      hello: string;
    }>(
      '/api/graphql',
      gql`
        query {
          hello
        }
      `
    );

    return hello;
  });

  if (isLoading) return <p>Loading...</p>;
  return <p>{data}</p>;
}
