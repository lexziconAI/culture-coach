import React from 'react';
import 'chart.js/auto';
import { Radar } from 'react-chartjs-2';
import { SessionState, DIMENSION_LABELS } from '../types';

interface CCARadarChartProps {
  dimensions: SessionState['dimensions'];
  strengths: string[];
  developmentPriorities: string[];
}

const CCARadarChart: React.FC<CCARadarChartProps> = ({ 
  dimensions, 
  strengths, 
  developmentPriorities 
}) => {
  // Helper to normalize scores
  const normalize = (val: number) => val <= 25 ? (val / 25) * 100 : val;

  const data = {
    // Use 2-letter codes to prevent cutting off
    labels: ['DT', 'TR', 'CO', 'CA', 'EP'],
    datasets: [{
      label: 'Your CCA Profile',
      data: [
        normalize(dimensions.DT.score),
        normalize(dimensions.TR.score),
        normalize(dimensions.CO.score),
        normalize(dimensions.CA.score),
        normalize(dimensions.EP.score)
      ],
      backgroundColor: 'rgba(99, 102, 241, 0.2)', // Indigo-500 with opacity
      borderColor: 'rgb(99, 102, 241)',
      borderWidth: 2,
      pointBackgroundColor: (context: any) => {
        const index = context.dataIndex;
        const dimCodes = ['DT', 'TR', 'CO', 'CA', 'EP'];
        const dimCode = dimCodes[index];
        
        if (strengths.includes(dimCode)) return 'rgb(34, 197, 94)';  // Green
        if (developmentPriorities.includes(dimCode)) return 'rgb(245, 158, 11)';  // Amber
        return 'rgb(99, 102, 241)';  // Default indigo
      },
      pointRadius: 6,
      pointHoverRadius: 8
    }]
  };

  const options = {
    layout: {
      padding: 20 // Add padding around the chart to prevent label clipping
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: {
          stepSize: 10,
          font: { size: 10 },
          backdropColor: 'transparent'
        },
        pointLabels: {
          font: { size: 12, weight: 700 as const },
          color: '#475569' // Slate-600
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        }
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          title: (context: any) => {
             const index = context[0].dataIndex;
             const dimCodes = ['DT', 'TR', 'CO', 'CA', 'EP'];
             const code = dimCodes[index];
             // Show the full name in the tooltip so the user still knows what 'DT' means
             return `${code}: ${DIMENSION_LABELS[code]}`; 
          },
          label: (context: any) => {
            const score = context.raw as number;
            let band = 'Low';
            if (score >= 80) band = 'Very High';
            else if (score >= 60) band = 'High';
            else if (score >= 40) band = 'Moderate';
            else if (score >= 20) band = 'Developing';
            
            return `Score: ${score.toFixed(1)}% (${band})`;
          }
        }
      }
    },
    maintainAspectRatio: true
  };

  return (
    <div className="w-full max-w-md mx-auto p-2">
      <Radar data={data} options={options} />
    </div>
  );
};

export default CCARadarChart;